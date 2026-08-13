import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';

export const dynamic = 'force-dynamic';

const schema = z.object({
  brief: z.string().optional(), // alias UI de description
  title: z.string().optional(),
  description: z.string().optional(),
  platform: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  suggestedDate: z.string().nullable().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().nullable().optional(),
  // Acte 4 — contenu concrétisé. `caption` écrit le Post lié (source de
  // vérité) + la copie de travail metadata.concretization ; `prompt` écrit
  // metadata.concretization.imagePrompt (utilisé par « Régénérer visuel »).
  // Avant, ces deux clés étaient supprimées SILENCIEUSEMENT par Zod : l'UI
  // affichait « enregistré » alors que rien n'était persisté.
  caption: z.string().optional(),
  prompt: z.string().optional(),
});

/**
 * PATCH /api/pipelines/[id]/items/[itemId] — édition d'un item de stratégie
 * (Acte 3 : brief/titre/format… ; Acte 4 : caption/prompt concrétisés).
 */
export const PATCH = handle(async (req, { params }) => {
  const { id, itemId } = await params;
  const { role, organizationId } = await resolvePipelineContext(id);
  requirePermission(role, 'post.edit');
  const body = schema.parse(await req.json());
  const { brief, caption, prompt, ...rest } = body;

  // === Contenu concrétisé (Acte 4) — autorisé même sur un item EXECUTED ===
  if (caption !== undefined || prompt !== undefined) {
    const item = await db.strategyItem.findUnique({
      where: { id: itemId },
      include: { strategy: { select: { organizationId: true } } },
    });
    if (!item || item.strategy.organizationId !== organizationId) {
      throw new NotFoundError('Item not found');
    }
    const meta = (item.metadata as Record<string, unknown> | null) ?? {};
    const conc = (meta.concretization as Record<string, unknown> | null) ?? {};
    if (prompt !== undefined) conc.imagePrompt = prompt;
    if (caption !== undefined) conc.caption = caption;
    await db.strategyItem.update({
      where: { id: itemId },
      data: {
        metadata: {
          ...meta,
          concretization: conc,
          ...(caption !== undefined ? { caption } : {}),
        } as never,
      },
    });
    // Le Post lié est la source de vérité de ce qui sera publié.
    if (caption !== undefined && item.postId) {
      await db.post
        .update({ where: { id: item.postId }, data: { body: caption } })
        .catch(() => undefined); // post supprimé entre-temps — la copie item reste valide
    }
  }

  // === Champs stratégiques (Acte 3) ===
  const strategicPatch = {
    ...rest,
    ...(brief !== undefined ? { description: brief } : {}),
  };
  if (Object.keys(strategicPatch).length > 0) {
    const item = await MarketingStrategyService.updateItemContent(itemId, organizationId, strategicPatch);
    return ok(item);
  }

  const fresh = await db.strategyItem.findUnique({ where: { id: itemId } });
  return ok(fresh);
});
