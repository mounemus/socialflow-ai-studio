import { redirect } from 'next/navigation';

/**
 * Ancienne route « Design Studio » — fusionnée dans l'onglet Visuel de
 * l'Atelier créatif unifié `/studio`. Redirection plutôt qu'un doublon de
 * surface (elle n'était déjà plus dans la navigation).
 */
export default function DesignStudioRedirect() {
  redirect('/studio?tab=visuel');
}
