import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { resolveBrandContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';
import { db } from '@/lib/db';

export const maxDuration = 120;

const schema = z.object({
  brandId: z.string(),
  horizon: z.enum(['30d', '90d', '12mo']).default('90d'),
  additionalContext: z.string().optional(),
  saveAsDraft: z.boolean().default(true),
});

export const POST = handle(async (req) => {
  const body = schema.parse(await req.json());
  const { organizationId, role, brand } = await resolveBrandContext(body.brandId);
  requirePermission(role, 'campaign.manage');

  const start = Date.now();
  const generated = await MarketingStrategyService.generate({
    organizationId,
    brandId: brand.id,
    horizon: body.horizon,
    additionalContext: body.additionalContext,
  });

  if (!body.saveAsDraft) {
    return ok({ ...generated, durationMs: Date.now() - start });
  }

  const saved = await MarketingStrategyService.save({
    organizationId,
    brandId: brand.id,
    horizon: body.horizon,
    title: `Stratégie ${brand.name} — ${body.horizon} (${new Date().toLocaleDateString('fr-FR')})`,
    strategy: generated.strategy,
    items: generated.items,
    generatedByModel: generated.mocked ? 'mock' : 'claude',
  });

  await db.aIRequest.create({
    data: {
      organizationId,
      type: 'TEXT',
      prompt: `Marketing strategy ${body.horizon} for ${brand.name}`,
      response: `Strategy saved as ${saved.id} with ${saved.items.length} items`,
      durationMs: Date.now() - start,
      success: true,
      metadata: { provider: generated.mocked ? 'mock' : 'claude', strategyId: saved.id } as never,
    },
  });

  return created({ strategy: saved, mocked: generated.mocked, durationMs: Date.now() - start });
});
