import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { SupabaseStorageService } from '@/services/storage/SupabaseStorageService';

/**
 * POST /api/media/upload-direct — upload côté serveur (clé service role) d'un
 * fichier image en data-URL. Filet de sécurité quand l'upload signé échoue
 * (politiques bucket, CORS…). Limité à ~3.5MB : la limite de corps Vercel est
 * 4.5MB et le base64 ajoute ~33%.
 */
const schema = z.object({
  dataUrl: z.string().max(4_800_000),
  brandId: z.string().optional(),
  filename: z.string().max(200).optional(),
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'media.upload');
  const body = schema.parse(await req.json());

  if (!SupabaseStorageService.isConfigured()) {
    return ok({ ok: false, error: 'Storage non configuré (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
  }
  const { url, error } = await SupabaseStorageService.uploadDataUrlDetailed({
    organizationId: ctx.organizationId,
    dataUrl: body.dataUrl,
    prefix: 'upload',
  });
  if (!url) {
    return ok({ ok: false, error: error ?? 'Upload refusé par le storage.' });
  }
  const mime = body.dataUrl.slice(5, body.dataUrl.indexOf(';'));
  const asset = await db.mediaAsset.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: body.brandId,
      kind: 'IMAGE',
      url,
      mimeType: mime,
      source: 'upload',
      metadata: { filename: body.filename ?? null, via: 'upload-direct' } as never,
    },
  });
  return ok({ ok: true, id: asset.id, url });
});
