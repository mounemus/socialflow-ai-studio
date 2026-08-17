import { redirect } from 'next/navigation';

/**
 * Ancienne route « Studio Canva » — fusionnée dans l'Atelier créatif unifié
 * `/studio` (onglet Canva). On redirige au lieu de maintenir deux surfaces
 * concurrentes, comme pour /ai-studio.
 */
export default function CanvaStudioRedirect() {
  redirect('/studio?tab=canva');
}
