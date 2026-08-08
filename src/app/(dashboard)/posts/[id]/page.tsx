import { PostDetail } from './PostDetail';

export const dynamic = 'force-dynamic';

/**
 * Vue détail d'une publication existante — surface FOCALISÉE (visuel + texte +
 * actions Valider/Programmer/Publier/Partager). Remplace l'ancienne redirection
 * vers le Studio de création (9 onglets Brief→Diffusion), qui désorientait
 * l'utilisateur en le sortant du contexte « je veux juste agir sur ce post ».
 * La Production, le Calendrier et les items de stratégie pointent ici. La
 * création avancée reste accessible via « Éditer dans le Studio » depuis cette
 * vue.
 */
export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PostDetail postId={id} />;
}
