import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { HealthService } from '@/services/admin/HealthService';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireSuperAdmin();
  const probes = await HealthService.runAll();
  const allOk = probes.every((p) => p.status === 'ok' || (p.status === 'not_configured' && !p.required));
  return ok({ overall: allOk ? 'ok' : 'attention', probes });
});
