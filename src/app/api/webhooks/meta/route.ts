import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Webhooks Meta (Facebook Pages + Instagram) — inbox temps réel.
 *
 * GET  : vérification d'abonnement (hub.challenge) avec META_WEBHOOK_VERIFY_TOKEN.
 * POST : événements signés X-Hub-Signature-256 (HMAC-SHA256, FACEBOOK_APP_SECRET).
 *        Sans secret configuré → refus (503). Signature invalide → 401.
 *        Ingestion idempotente : SocialInteraction.externalId est @unique,
 *        rejouer un événement ne crée pas de doublon.
 *
 * Configuration côté Meta App Dashboard :
 *   - Callback URL: {APP_URL}/api/webhooks/meta
 *   - Champs: feed (Pages), comments/mentions (Instagram), messages (optionnel)
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

interface MetaChange {
  field: string;
  value: {
    item?: string;
    verb?: string;
    comment_id?: string;
    post_id?: string;
    message?: string;
    text?: string;
    from?: { id?: string; name?: string; username?: string };
    media?: { id?: string };
    id?: string;
  };
}
interface MetaEntry {
  id: string; // page id (object=page) ou ig user id (object=instagram)
  time?: number;
  changes?: MetaChange[];
}

async function ingestChange(
  objectType: string,
  entry: MetaEntry,
  change: MetaChange,
): Promise<'created' | 'skipped'> {
  const v = change.value;
  const externalId =
    v.comment_id ?? v.id ?? (v.post_id ? `${v.post_id}:${entry.time ?? ''}` : null);
  const content = v.message ?? v.text ?? '';
  if (!externalId || !content) return 'skipped';
  // Seuls les commentaires/mentions entrants nous intéressent ici.
  if (change.field === 'feed' && v.item && v.item !== 'comment') return 'skipped';

  // Résolution du compte : object=instagram → SocialAccount.externalId = entry.id ;
  // object=page → SocialPage.externalId = entry.id → compte parent.
  let account =
    objectType === 'instagram'
      ? await db.socialAccount.findFirst({ where: { platform: 'INSTAGRAM', externalId: entry.id } })
      : null;
  if (!account) {
    const page = await db.socialPage.findFirst({
      where: { externalId: entry.id },
      include: { socialAccount: true },
    });
    account = page?.socialAccount ?? null;
  }
  if (!account) {
    logger.warn('Webhook Meta: aucun compte correspondant', { objectType, entryId: entry.id });
    return 'skipped';
  }

  const isMention = change.field.includes('mention');
  try {
    await db.socialInteraction.create({
      data: {
        organizationId: account.organizationId,
        brandId: account.brandId,
        socialAccountId: account.id,
        externalId,
        platform: account.platform,
        type: isMention ? 'MENTION' : 'COMMENT',
        content,
        fromHandle: v.from?.username ?? v.from?.name ?? v.from?.id ?? 'inconnu',
        fromName: v.from?.name ?? null,
        rawData: { objectType, field: change.field, value: v } as never,
        receivedAt: entry.time ? new Date(entry.time * 1000) : new Date(),
      },
    });
    return 'created';
  } catch (err) {
    // P2002 = déjà ingéré (rejeu de webhook) — idempotence normale.
    if ((err as { code?: string }).code === 'P2002') return 'skipped';
    throw err;
  }
}

export async function POST(req: Request) {
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (!secret) {
    logger.warn('Webhook Meta reçu mais FACEBOOK_APP_SECRET non configuré — refusé');
    return new NextResponse('Webhook not configured', { status: 503 });
  }

  const raw = await req.text();
  const signature = req.headers.get('x-hub-signature-256') ?? '';
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    logger.warn('Webhook Meta: signature invalide');
    return new NextResponse('Invalid signature', { status: 401 });
  }

  try {
    const payload = JSON.parse(raw) as { object?: string; entry?: MetaEntry[] };
    let createdCount = 0;
    let skipped = 0;
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const r = await ingestChange(payload.object ?? 'page', entry, change);
        if (r === 'created') createdCount++;
        else skipped++;
      }
    }
    logger.info('Webhook Meta traité', { object: payload.object, created: createdCount, skipped });
    return NextResponse.json({ ok: true, created: createdCount, skipped });
  } catch (err) {
    logger.error('Webhook Meta: traitement échoué', { err: (err as Error).message });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
