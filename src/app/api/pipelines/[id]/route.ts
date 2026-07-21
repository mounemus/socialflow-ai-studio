import { handle, ok } from '@/lib/api';
import { resolvePipelineContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { stripDataUrls } from '@/lib/strip-data-urls';
import { BrandPipelineService } from '@/services/pipeline/BrandPipelineService';

export const dynamic = 'force-dynamic';

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  // Autorisation uniquement (requête légère) — le run complet est chargé une
  // seule fois ci-dessous. Avant, la ligne (potentiellement plusieurs Mo)
  // était lue DEUX fois à chaque poll de 3 s.
  await resolvePipelineContext(id);
  const run = await db.brandPipelineRun.findUnique({
    where: { id },
    // `trace` est un journal de debug jamais lu par l'UI et potentiellement
    // très volumineux : on ne le transporte pas dans un payload pollé.
    omit: { trace: true },
    include: {
      brand: { select: { id: true, name: true, industry: true } },
      strategy: {
        select: {
          id: true,
          title: true,
          status: true,
          horizon: true,
          items: { orderBy: { order: 'asc' } },
        },
      },
      startedBy: { select: { id: true, name: true, email: true } },
      approvedProfileBy: { select: { id: true, name: true, email: true } },
      approvedStrategyBy: { select: { id: true, name: true, email: true } },
    },
  });
  // Payload servi au polling : on retire les images base64 héritées
  // (plusieurs Mo chacune) — les nouveaux visuels sont des URLs Storage.
  return ok(stripDataUrls(run));
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const { userId, role } = await resolvePipelineContext(id);
  requirePermission(role, 'brand.manage');

  // Runs zombies (aucune marque créée) et runs terminés : suppression réelle —
  // il n'y a rien à préserver et ils encombrent la liste.
  const run = await db.brandPipelineRun.findUnique({
    where: { id },
    select: { status: true, brandId: true },
  });
  const isTerminal =
    run && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status);
  const isZombie = run && !run.brandId;
  if (isTerminal || isZombie) {
    await db.brandPipelineRun.delete({ where: { id } });
    return ok({ deleted: true });
  }

  await BrandPipelineService.cancel(id, userId);
  return ok({ cancelled: true });
});
