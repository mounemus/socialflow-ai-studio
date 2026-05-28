import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { SupabaseStorageService } from '@/services/storage/SupabaseStorageService';

const schema = z.object({
  filename: z.string().min(1),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'media.upload');
  const body = schema.parse(await req.json());

  if (!SupabaseStorageService.isConfigured()) {
    return ok({
      configured: false,
      reason: 'Storage non configuré. Configure SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY via /admin/setup/supabase.',
    });
  }

  // 25MB hard cap. Plan-based gating: TODO when billing wired.
  if (body.sizeBytes && body.sizeBytes > 25 * 1024 * 1024) {
    return ok({ configured: true, error: 'File trop volumineux (max 25MB)' });
  }

  const signed = await SupabaseStorageService.createSignedUploadUrl({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    filename: body.filename,
  });

  return ok({ configured: true, ...signed });
});
