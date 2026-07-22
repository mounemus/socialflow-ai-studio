/**
 * Garde-fou des variables d'environnement posées depuis l'admin.
 *
 * Cas réel : LATE_API_BASE avait été remplacée par l'URL d'une page Facebook
 * (https://www.facebook.com/profile.php?id=…) — l'intégration Zernio pointait
 * alors vers une page sociale au lieu de l'API, et tout le pont publication
 * était silencieusement cassé. On refuse désormais ce type de valeur AVANT
 * l'écriture chez Vercel.
 */

const SOCIAL_PAGE_HOSTS =
  /(^|\.)(facebook|instagram|linkedin|twitter|x|tiktok|youtube|pinterest)\.com$/i;

/**
 * Valide la valeur d'une variable « base d'API » (clés *_API_BASE /
 * *_BASE_URL). Renvoie un message d'erreur en français, ou null si OK.
 * Les autres clés ne sont pas concernées (renvoie null).
 */
export function apiBaseProblem(key: string, value: string): string | null {
  if (!/(_API_BASE|_BASE_URL)$/.test(key)) return null;
  if (!value) return null; // vide = retomber sur le défaut du code, autorisé

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${key} : « ${value.slice(0, 60)} » n'est pas une URL valide.`;
  }
  if (url.protocol !== 'https:') {
    return `${key} : l'URL d'API doit être en https.`;
  }
  if (SOCIAL_PAGE_HOSTS.test(url.hostname)) {
    return (
      `${key} : « ${url.hostname} » est une page de réseau social, pas une API. ` +
      `Attendu : l'URL de l'API du fournisseur (ex. https://zernio.com/api/v1).`
    );
  }
  return null;
}
