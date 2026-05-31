import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BulkImportService } from '@/services/import/BulkImportService';

const schema = z.object({
  brandId: z.string().optional(),
  csvText: z.string().min(1),
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.create');
  const body = schema.parse(await req.json());

  const rows = BulkImportService.parseCsv(body.csvText);
  const result = await BulkImportService.importFromRows({
    organizationId: ctx.organizationId,
    brandId: body.brandId,
    rows,
  });

  return ok({ parsed: rows.length, ...result });
});
