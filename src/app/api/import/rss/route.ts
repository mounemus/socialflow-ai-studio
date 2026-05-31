import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { BulkImportService } from '@/services/import/BulkImportService';

const schema = z.object({
  brandId: z.string().optional(),
  feedUrl: z.string().url(),
  limit: z.number().int().min(1).max(50).optional(),
  asFormat: z.string().optional(),
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.create');
  const body = schema.parse(await req.json());

  const result = await BulkImportService.importFromRss({
    organizationId: ctx.organizationId,
    brandId: body.brandId,
    feedUrl: body.feedUrl,
    limit: body.limit,
    asFormat: body.asFormat,
  });

  return ok({ created: result.created, items: result.items.length });
});
