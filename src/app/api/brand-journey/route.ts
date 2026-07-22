import { handle, ok } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export type JourneyStepId =
  | 'brand'
  | 'strategy'
  | 'connections'
  | 'content'
  | 'plan'
  | 'publish'
  | 'measure';

export type JourneyStep = {
  id: JourneyStepId;
  label: string;
  detail: string;
  done: boolean;
  href: string;
  cta: string;
};

/**
 * GET /api/brand-journey — le fil conducteur de la refonte « Orbit ».
 *
 * Calcule, sur les données RÉELLES de l'organisation (filtrées par la marque
 * active), où en est l'utilisateur dans le parcours :
 *   marque → stratégie IA → connexions → création → planification →
 *   publication → mesure.
 *
 * Chaque étape est vérifiée en base — aucune progression simulée. Le front
 * affiche la première étape non faite comme « prochaine action utile ».
 */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  const orgId = ctx.organizationId;
  const activeBrandId = await getActiveBrandId(orgId);
  const brandFilter = activeBrandId ? { brandId: activeBrandId } : {};

  const [brandCount, completedPipeline, connectedAccounts, postCount, futureSchedules, publishedCount] =
    await Promise.all([
      db.brand.count({ where: { organizationId: orgId, ...(activeBrandId ? { id: activeBrandId } : {}) } }),
      db.brandPipelineRun.count({
        where: { organizationId: orgId, ...brandFilter, status: 'COMPLETED' },
      }),
      db.socialAccount.count({
        where: { organizationId: orgId, status: { in: ['CONNECTED', 'DEGRADED'] } },
      }),
      db.post.count({ where: { organizationId: orgId, ...brandFilter, status: { not: 'ARCHIVED' } } }),
      db.postSchedule.count({
        where: { post: { organizationId: orgId, ...brandFilter }, scheduledFor: { gte: new Date() } },
      }),
      db.post.count({ where: { organizationId: orgId, ...brandFilter, status: 'PUBLISHED' } }),
    ]);

  const steps: JourneyStep[] = [
    {
      id: 'brand',
      label: 'Créer votre marque',
      detail: 'Identité, secteur et ton — la base de tout le reste.',
      done: brandCount > 0,
      href: '/brands/new',
      cta: 'Créer ma marque',
    },
    {
      id: 'strategy',
      label: 'Développer la stratégie avec l’IA',
      detail: 'Positionnement, audience, piliers éditoriaux et plan.',
      done: completedPipeline > 0,
      href: '/pipelines/new',
      cta: 'Lancer ma stratégie IA',
    },
    {
      id: 'connections',
      label: 'Connecter vos réseaux',
      detail: 'Instagram, LinkedIn, Facebook — pour publier sans quitter l’app.',
      done: connectedAccounts > 0,
      href: '/social-accounts',
      cta: 'Connecter un réseau',
    },
    {
      id: 'content',
      label: 'Créer votre premier contenu',
      detail: 'Le Studio applique automatiquement votre voix et vos piliers.',
      done: postCount > 0,
      href: '/studio',
      cta: 'Créer un contenu',
    },
    {
      id: 'plan',
      label: 'Planifier vos publications',
      detail: 'Un rythme régulier vaut mieux qu’un coup d’éclat.',
      done: futureSchedules > 0,
      href: '/calendar',
      cta: 'Ouvrir le calendrier',
    },
    {
      id: 'publish',
      label: 'Publier',
      detail: 'Validation puis publication automatique ou manuelle.',
      done: publishedCount > 0,
      href: '/production',
      cta: 'Voir la file de production',
    },
    {
      id: 'measure',
      label: 'Mesurer et itérer',
      detail: 'Les chiffres réels nourrissent les recommandations IA.',
      done: publishedCount > 0,
      href: '/analytics',
      cta: 'Voir l’analytique',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done) ?? null;

  return ok({
    steps,
    doneCount,
    total: steps.length,
    progress: Math.round((doneCount / steps.length) * 100),
    next,
    activeBrandId,
  });
});
