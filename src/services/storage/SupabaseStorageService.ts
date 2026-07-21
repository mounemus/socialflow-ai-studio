/**
 * SupabaseStorageService — managed file storage with signed upload URLs.
 *
 * Pattern (avoids Vercel 4.5MB body limit):
 *   1. Client POSTs file metadata to /api/media/sign-upload
 *   2. Server creates a signed upload URL via Supabase Storage (service role key)
 *   3. Client uploads directly to Supabase using that URL
 *   4. Client confirms by POST /api/media with the resulting public URL
 *
 * Fallback: if SUPABASE_SERVICE_ROLE_KEY is missing, returns a mock signed URL
 * (data URL placeholder) so the UI still works for dev.
 *
 * Buckets: socialflow-media (public). Files are namespaced per organization:
 *   {organizationId}/{userId}/{timestamp}_{filename}
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ExternalApiError } from '@/lib/errors';

let _client: SupabaseClient | null = null;

/**
 * Normalize a Supabase URL: strip trailing slash + common path mistakes like /rest/v1/.
 * Users often paste the "API URL" from Supabase dashboard which includes /rest/v1/.
 */
export function normalizeSupabaseUrl(raw: string): string {
  return raw.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

function getClient(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(normalizeSupabaseUrl(url), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'socialflow-media';

export const SupabaseStorageService = {
  isConfigured(): boolean {
    return getClient() !== null;
  },

  bucket(): string {
    return BUCKET;
  },

  /**
   * Sanitize a filename: keep extension, alphanumeric base.
   */
  sanitizeFilename(name: string): string {
    const dot = name.lastIndexOf('.');
    const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60);
    const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
    return `${base}${ext}`;
  },

  /**
   * Generate a signed upload URL for direct client→Supabase uploads.
   * Returns path + signedUrl + final publicUrl.
   */
  /**
   * Upload direct côté serveur d'une image en data-URL (base64) → URL publique.
   * Indispensable pour les images IA (DALL-E renvoie du base64) : on ne stocke
   * JAMAIS plusieurs Mo de base64 en base — ça empoisonne tous les payloads.
   * Retourne null si le storage n'est pas configuré ou en cas d'échec.
   */
  async uploadDataUrl(opts: {
    organizationId: string;
    dataUrl: string;
    prefix?: string;
  }): Promise<string | null> {
    const client = getClient();
    if (!client) return null;
    const m = opts.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!m) return null;
    const mime = m[1];
    const ext = (mime.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
    const buf = Buffer.from(m[2], 'base64');
    const path = `${opts.organizationId}/${opts.prefix ?? 'ai'}/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`;
    const { error } = await client.storage.from(BUCKET).upload(path, buf, {
      contentType: mime,
      upsert: false,
    });
    if (error) return null;
    const { data } = client.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  },

  async createSignedUploadUrl(params: {
    organizationId: string;
    userId: string;
    filename: string;
  }): Promise<{
    path: string;
    signedUrl: string;
    publicUrl: string;
    token: string;
  }> {
    const client = getClient();
    if (!client) {
      throw new ExternalApiError('supabase-storage', 'Storage non configuré (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY manquants)');
    }

    const safe = this.sanitizeFilename(params.filename);
    const path = `${params.organizationId}/${params.userId}/${Date.now()}_${safe}`;

    const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw new ExternalApiError('supabase-storage', error.message);

    const { data: pub } = client.storage.from(BUCKET).getPublicUrl(path);

    return {
      path,
      signedUrl: data.signedUrl,
      publicUrl: pub.publicUrl,
      token: data.token,
    };
  },

  /**
   * Delete an object by path. Used when removing a MediaAsset.
   */
  async deleteByPath(path: string): Promise<void> {
    const client = getClient();
    if (!client) return;
    const { error } = await client.storage.from(BUCKET).remove([path]);
    if (error) throw new ExternalApiError('supabase-storage', error.message);
  },

  /**
   * Verify a URL belongs to our bucket (security check before storing in DB).
   */
  isOurStorageUrl(url: string): boolean {
    const supaUrl = process.env.SUPABASE_URL;
    if (!supaUrl) return false;
    return url.startsWith(`${supaUrl}/storage/v1/object/public/${BUCKET}/`);
  },
};
