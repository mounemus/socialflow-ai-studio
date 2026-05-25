import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { CanvaConnectService } from '@/services/integrations/CanvaConnectService';

export const POST = handle(async () => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'org.manage');
  await CanvaConnectService.disconnect(ctx.organizationId);
  return ok({ disconnected: true });
});
