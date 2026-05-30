import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { NextActionService } from '@/services/dashboard/NextActionService';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const result = await NextActionService.computeFor(ctx.organizationId);
  return ok(result);
});
