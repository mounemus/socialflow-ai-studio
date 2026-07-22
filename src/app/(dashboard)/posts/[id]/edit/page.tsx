import { redirect } from 'next/navigation';

/**
 * /posts/[id]/edit n'a jamais été une vraie page — plusieurs liens
 * historiques (toasts du Studio IA, favoris) pointaient pourtant dessus et
 * tombaient sur un 404. Redirection permanente vers la page de détail,
 * qui contient l'édition.
 */
export default async function PostEditRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/posts/${id}`);
}
