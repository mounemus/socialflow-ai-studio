import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { AIModelPreferenceService } from '@/services/ai/AIModelPreferenceService';
import { MODEL_CATALOG, providerConfigured } from '@/services/ai/model-catalog';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/ai/model-preferences — préférences org + catalogue (avec
 *      disponibilité réelle de chaque fournisseur).
 * PATCH /api/ai/model-preferences { category, mode, provider?, model? }
 */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  const prefs = await AIModelPreferenceService.forOrg(ctx.organizationId);
  const catalog = Object.fromEntries(
    Object.entries(MODEL_CATALOG).map(([cat, providers]) => [
      cat,
      providers.map((p) => ({
        id: p.id,
        label: p.label,
        configured: providerConfigured(p),
        models: p.models,
      })),
    ]),
  );
  return ok({ prefs, catalog });
});

const patchSchema = z.object({
  category: z.enum(['TEXT', 'IMAGE', 'VIDEO']),
  mode: z.enum(['AUTO', 'FORCED']),
  provider: z.string().optional(),
  model: z.string().optional(),
});

export const PATCH = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'org.manage');
  const body = patchSchema.parse(await req.json());
  const pref = await AIModelPreferenceService.set(ctx.organizationId, body.category, {
    mode: body.mode,
    provider: body.provider ?? null,
    model: body.model ?? null,
  });
  return ok({ category: body.category, ...pref });
});
