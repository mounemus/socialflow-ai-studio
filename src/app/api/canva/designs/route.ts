import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { CanvaService } from '@/services/canva/CanvaService';

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const designs = await CanvaService.listCanvaDesigns(ctx.organizationId);
  return ok({ designs, apiEnabled: CanvaService.isApiEnabled() });
});
