/**
 * Upload d'un Blob quelconque (ex. clip vidéo découpé côté client) vers le
 * storage média. Mirrors exactement le flux 3 étapes de MediaUploader
 * (src/components/ui/media-uploader.tsx) : signature → PUT direct → enregistrement DB.
 */
export async function uploadBlob(opts: {
  blob: Blob;
  filename: string;
  contentType: string;
  brandId?: string | null;
}): Promise<{ id: string; url: string } | null> {
  const { blob, filename, contentType, brandId } = opts;

  // 1. Signature de l'URL d'upload
  const signRes = await fetch('/api/media/sign-upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename, contentType, sizeBytes: blob.size }),
  });
  if (!signRes.ok) {
    const err = await signRes.json().catch(() => ({}));
    throw new Error(err?.message ?? `Échec signature (${signRes.status})`);
  }
  const { data: sign } = await signRes.json();
  if (!sign.configured) throw new Error(sign.reason ?? 'Storage non configuré');
  if (sign.error) throw new Error(sign.error);

  // 2. Upload direct vers Supabase Storage via l'URL signée
  const uploadRes = await fetch(sign.signedUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upsert': 'true' },
    body: blob,
  });
  if (!uploadRes.ok) throw new Error(`Upload direct refusé (${uploadRes.status})`);

  // 3. Enregistrement du MediaAsset en DB
  const kind = contentType.startsWith('image/')
    ? 'IMAGE'
    : contentType.startsWith('video/')
      ? 'VIDEO'
      : contentType.startsWith('audio/')
        ? 'AUDIO'
        : 'DOCUMENT';
  const saveRes = await fetch('/api/media', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: sign.publicUrl,
      brandId: brandId ?? undefined,
      kind,
      mimeType: contentType,
      source: 'upload',
    }),
  });
  if (!saveRes.ok) throw new Error('Échec enregistrement DB');
  const { data: saved } = await saveRes.json();
  return { id: saved.id, url: sign.publicUrl as string };
}
