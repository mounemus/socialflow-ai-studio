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
import { logger } from '@/lib/logger';

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

/**
 * Le bucket est créé automatiquement au premier besoin (clé service role).
 * Cause racine du « Échec signing » : bucket jamais provisionné sur le projet
 * Supabase → createSignedUploadUrl répondait « Bucket not found ».
 */
async function ensureBucket(client: SupabaseClient): Promise<void> {
  const { error } = await client.storage.createBucket(BUCKET, { public: true });
  // "already exists" = OK ; toute autre erreur remontera lors du retry.
  if (error && !/already exists|duplicate/i.test(error.message)) {
    logger.warn('createBucket refusé', { bucket: BUCKET, err: error.message });
  }
}

function isBucketMissing(message: string): boolean {
  return /bucket.*not.*found|not.*found.*bucket/i.test(message);
}

/**
 * Rôle porté par la clé Supabase configurée (JWT non vérifié — lecture du
 * payload seulement). Diagnostic clé : une clé « anon » collée à la place de
 * la « service_role » fait échouer TOUS les uploads (RLS) avec un message
 * cryptique — on le dit explicitement.
 */
function configuredKeyRole(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function explainStorageError(message: string): string {
  const role = configuredKeyRole();
  if (role && role !== 'service_role') {
    return `${message} — la clé configurée en SUPABASE_SERVICE_ROLE_KEY est une clé « ${role} », pas « service_role ». Copiez la clé service_role (Supabase → Settings → API) dans Vercel.`;
  }
  return message;
}

export const SupabaseStorageService = {
  isConfigured(): boolean {
    return getClient() !== null;
  },

  keyRole: configuredKeyRole,

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
    return (await this.uploadDataUrlDetailed(opts)).url;
  },

  /** Variante qui remonte la cause exacte de l'échec (affichable à l'utilisateur). */
  async uploadDataUrlDetailed(opts: {
    organizationId: string;
    dataUrl: string;
    prefix?: string;
  }): Promise<{ url: string | null; error?: string }> {
    // Toute sortie `null` est tracée avec sa cause : sans cela, un échec de
    // stockage devenait un visuel absent SANS aucun moyen de savoir pourquoi
    // (bucket inexistant, droits, clé absente…), et l'UI annonçait un succès.
    const client = getClient();
    if (!client) {
      logger.warn('uploadDataUrl: storage non configuré', {
        hasUrl: !!process.env.SUPABASE_URL,
        hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      });
      return { url: null, error: 'Storage non configuré (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' };
    }
    const m = opts.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!m) {
      logger.warn('uploadDataUrl: data-URL non reconnue', {
        head: opts.dataUrl.slice(0, 40),
        length: opts.dataUrl.length,
      });
      return { url: null, error: 'Format de fichier non reconnu (image attendue).' };
    }
    const mime = m[1];
    const ext = (mime.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
    const buf = Buffer.from(m[2], 'base64');
    const path = `${opts.organizationId}/${opts.prefix ?? 'ai'}/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`;
    let { error } = await client.storage.from(BUCKET).upload(path, buf, {
      contentType: mime,
      upsert: false,
    });
    if (error && isBucketMissing(error.message)) {
      await ensureBucket(client);
      ({ error } = await client.storage.from(BUCKET).upload(path, buf, {
        contentType: mime,
        upsert: false,
      }));
    }
    if (error) {
      logger.warn('uploadDataUrl: upload Supabase refusé', {
        bucket: BUCKET,
        path,
        bytes: buf.length,
        err: error.message,
        keyRole: configuredKeyRole(),
      });
      return { url: null, error: explainStorageError(`Supabase: ${error.message}`) };
    }
    const { data } = client.storage.from(BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) {
      logger.warn('uploadDataUrl: pas d’URL publique (bucket privé ?)', { bucket: BUCKET, path });
      return { url: null, error: `Pas d'URL publique — le bucket ${BUCKET} est probablement privé.` };
    }
    return { url: data.publicUrl };
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

    let { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error && isBucketMissing(error.message)) {
      await ensureBucket(client);
      ({ data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(path));
    }
    if (error) throw new ExternalApiError('supabase-storage', explainStorageError(`${error.message} (bucket: ${BUCKET})`));
    if (!data) throw new ExternalApiError('supabase-storage', 'Réponse signée vide');

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
