import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIProviderService } from '@/services/ai/AIProviderService';
import { sanitizeSocialText } from '@/lib/social-text';

const PLATFORM_LIMITS: Record<string, number> = {
  INSTAGRAM: 2200, FACEBOOK: 5000, LINKEDIN: 3000, TWITTER: 280,
  TIKTOK: 2200, YOUTUBE: 5000, PINTEREST: 500,
};

export const maxDuration = 60;

/**
 * GET  /api/posts/[id]/variants — variantes existantes
 * POST /api/posts/[id]/variants — générer des variantes A/B (et/ou par réseau)
 * Chaque variante porte son provider et son drapeau mocked — une variante
 * simulée n'est jamais présentée comme du contenu IA réel.
 */
export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  await resolvePostContext(id);
  const variants = await db.postVariant.findMany({
    where: { postId: id },
    orderBy: { label: 'asc' },
  });
  return ok(variants);
});

const genSchema = z.object({
  count: z.number().int().min(1).max(4).default(2),
  platforms: z.array(z.string()).max(7).optional(),
  instruction: z.string().max(500).optional(),
});

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { role, post } = await resolvePostContext(id);
  requirePermission(role, 'ai.use');
  const body = genSchema.parse(await req.json());

  const baseText = post.body ?? post.title ?? '';
  const targets: { label: string; platform?: string }[] = body.platforms?.length
    ? body.platforms.map((p) => ({ label: p, platform: p }))
    : Array.from({ length: body.count }, (_, i) => ({ label: String.fromCharCode(65 + i) }));

  const results = [];
  for (const t of targets) {
    const limit = t.platform ? PLATFORM_LIMITS[t.platform.toUpperCase()] : undefined;
    const prompt = [
      `Réécris cette publication en variante "${t.label}"${t.platform ? ` optimisée pour ${t.platform}` : ''}.`,
      body.instruction ?? 'Garde le message central mais varie l’accroche, la structure et le ton.',
      limit ? `Longueur maximale : ${limit} caractères.` : '',
      'Réponds UNIQUEMENT avec le texte final de la publication, prêt à publier tel quel.',
      'Interdits : titre ou en-tête (« VERSION… », « Post… »), markdown (#, **, ---), préambule, commentaire.',
      `--- PUBLICATION ORIGINALE ---\n${sanitizeSocialText(baseText)}`,
    ].filter(Boolean).join('\n');
    const out = await AIProviderService.generateText({
      prompt,
      platform: t.platform,
      language: 'fr',
    });
    const variant = await db.postVariant.create({
      data: {
        postId: id,
        label: t.label,
        body: sanitizeSocialText(out.text),
        hashtags: out.hashtags ?? [],
        cta: out.cta ?? null,
        platform: t.platform ?? null,
        provider: out.provider,
        mocked: out.mocked,
      },
    });
    results.push(variant);
  }
  return created(results);
});
