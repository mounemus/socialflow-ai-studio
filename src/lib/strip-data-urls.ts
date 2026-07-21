/**
 * Supprime récursivement les data-URLs volumineuses (images base64) d'un
 * payload JSON avant envoi au client. Des visuels DALL-E en base64 stockés en
 * base peuvent peser plusieurs Mo chacun — servis dans un payload pollé toutes
 * les 3 s, ils rendent les pages inutilisables.
 *
 * Un data-URL retiré est remplacé par '' (l'UI affiche « visuel indisponible »
 * et propose la régénération — qui passe désormais par Supabase Storage).
 */
const MAX_INLINE_DATA_URL = 8 * 1024; // les petites data-URLs (icônes) passent

export function stripDataUrls<T>(value: T): T {
  if (typeof value === 'string') {
    if (value.startsWith('data:') && value.length > MAX_INLINE_DATA_URL) {
      return '' as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripDataUrls(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripDataUrls(v);
    }
    return out as unknown as T;
  }
  return value;
}
