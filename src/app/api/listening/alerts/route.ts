import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { MentionAlertService } from '@/services/listening/MentionAlertService';

/**
 * GET /api/listening/alerts
 * List MentionAlert rows for the active org, newest first.
 * Query: acknowledged ("true" | "false") to filter by ack state.
 * Multi-tenant safe (scoped to ctx.organizationId).
 */
const querySchema = z.object({
  acknowledged: z.enum(['true', 'false']).optional(),
});

export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const q = querySchema.parse({
    acknowledged: url.searchParams.get('acknowledged') ?? undefined,
  });

  const acknowledged =
    q.acknowledged === undefined ? undefined : q.acknowledged === 'true';

  const activeBrandId = await getActiveBrandId(ctx.organizationId);
  const alerts = await MentionAlertService.listAlerts({
    orgId: ctx.organizationId,
    acknowledged,
    brandId: activeBrandId,
  });

  return ok({ alerts });
});
