import { redirect } from 'next/navigation';

/**
 * Ancienne route « Studio IA » (onglets Texte/Image) — fusionnée dans l'Atelier
 * créatif unifié `/studio`, qui réutilise les MÊMES composants (TextStudio,
 * ImageStudio) dans un parcours complet Brief → … → Diffusion. On redirige au
 * lieu de maintenir deux surfaces concurrentes ; `?postId=`/`?brandId=` sont
 * conservés pour ne pas casser les liens existants.
 */
export default async function AiStudioRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (typeof sp.postId === 'string') qs.set('postId', sp.postId);
  if (typeof sp.brandId === 'string') qs.set('brandId', sp.brandId);
  const suffix = qs.toString();
  redirect(suffix ? `/studio?${suffix}` : '/studio');
}
