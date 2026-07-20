import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { SocialGatewayService } from '@/services/gateway/SocialGatewayService';

/**
 * POST /api/webhooks/late — mises à jour de statut envoyées par Late/Zernio.
 *
 * Sécurité: signature HMAC-SHA256 du corps brut avec LATE_WEBHOOK_SECRET
 * (header x-late-signature ou x-webhook-signature). Sans secret configuré,
 * le webhook est REFUSÉ — jamais d'ingestion non authentifiée.
 * Idempotent: rejouer un événement ne change pas l'état final.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export async function POST(req: Request) {
  const secret = process.env.LATE_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn('Webhook Late reçu mais LATE_WEBHOOK_SECRET non configuré — refusé');
    return new NextResponse('Webhook not configured', { status: 503 });
  }

  const raw = await req.text();
  const signature =
    req.headers.get('x-late-signature') ?? req.headers.get('x-webhook-signature') ?? '';
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (!signature || !timingSafeEq(signature.replace(/^sha256=/, ''), expected)) {
    logger.warn('Webhook Late: signature invalide');
    return new NextResponse('Invalid signature', { status: 401 });
  }

  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const post = (payload.post ?? payload) as {
      _id?: string;
      postId?: string;
      status?: string;
      platformPostId?: string;
      platformPostUrl?: string;
    };
    const result = await SocialGatewayService.handleLateWebhook(post);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Webhook Late: traitement échoué', { err: (err as Error).message });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
