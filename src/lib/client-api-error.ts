/**
 * Extraction d'un message d'erreur lisible depuis une réponse API côté client.
 * Ne renvoie JAMAIS une page HTML brute (404/500 Next) dans un toast.
 */
export async function apiErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `Erreur ${res.status}`;
  if (text.trimStart().startsWith('<')) {
    return res.status === 404
      ? 'Endpoint introuvable (404) — recharge la page, une mise à jour est peut-être en cours.'
      : `Erreur serveur ${res.status}`;
  }
  try {
    const json = JSON.parse(text) as { message?: string; error?: string };
    return json.message ?? json.error ?? text.slice(0, 120);
  } catch {
    return text.slice(0, 120);
  }
}
