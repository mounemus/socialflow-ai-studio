/**
 * BrandWorkspaceService — données du Centre de travail par marque.
 * Une seule règle : TOUT est scopé (brandId + organizationId). Aucune donnée
 * d'une autre organisation ou d'une marque supprimée ne peut sortir d'ici.
 */
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { NextActionService } from './NextActionService';

const PROFILE_FIELDS: { key: string; label: string }[] = [
  { key: 'slogan', label: 'Slogan' },
  { key: 'mission', label: 'Mission' },
  { key: 'values', label: 'Valeurs' },
  { key: 'audienceTarget', label: 'Audience cible' },
  { key: 'productsServices', label: 'Produits/Services' },
  { key: 'toneOfVoice', label: 'Ton de voix' },
  { key: 'wordsToUse', label: 'Mots à utiliser' },
  { key: 'wordsToAvoid', label: 'Mots à éviter' },
  { key: 'officialHashtags', label: 'Hashtags officiels' },
  { key: 'primaryColor', label: 'Couleur principale' },
  { key: 'visualStyle', label: 'Style visuel' },
  { key: 'typography', label: 'Typographie' },
];

function isFilled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export const BrandWorkspaceService = {
  async getWorkspace(organizationId: string, brandId: string) {
    const brand = await db.brand.findFirst({
      where: { id: brandId, organizationId },
      include: { profile: true, client: { select: { id: true, name: true } } },
    });
    if (!brand) throw new NotFoundError('Marque introuvable pour cette organisation');

    const now = new Date();
    const in7days = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const since30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

    const [
      activeStrategy,
      pendingApprovals,
      upcoming,
      inProduction,
      blocked,
      socialAccounts,
      perf,
      lastAgentRuns,
      nextAction,
    ] = await Promise.all([
      db.marketingStrategy.findFirst({
        where: { brandId: brand.id, organizationId, status: { in: ['VALIDATED', 'IN_EXECUTION'] } },
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { items: true } } },
      }),
      db.approvalRequest.findMany({
        where: { organizationId, status: { in: ['PENDING', 'IN_REVIEW'] }, post: { brandId: brand.id } },
        include: { post: { select: { id: true, title: true, format: true } } },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
      db.postSchedule.findMany({
        where: {
          scheduledFor: { gte: now, lte: in7days },
          post: { brandId: brand.id, organizationId },
        },
        include: {
          post: { select: { id: true, title: true, format: true } },
          socialAccount: { select: { platform: true, handle: true } },
        },
        orderBy: { scheduledFor: 'asc' },
        take: 20,
      }),
      db.post.findMany({
        where: {
          brandId: brand.id,
          organizationId,
          status: { in: ['DRAFT', 'AI_GENERATED', 'IN_DESIGN', 'DESIGN_LINKED', 'PENDING_APPROVAL'] },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, status: true, format: true, updatedAt: true },
        take: 10,
      }),
      db.postSchedule.findMany({
        where: {
          status: { in: ['FAILED', 'ACTION_REQUIRED', 'MANUAL_SHARE_REQUIRED'] },
          post: { brandId: brand.id, organizationId },
        },
        include: {
          post: { select: { id: true, title: true } },
          socialAccount: { select: { platform: true, handle: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      db.socialAccount.findMany({
        where: { organizationId, OR: [{ brandId: brand.id }, { brandId: null }] },
        select: { id: true, platform: true, handle: true, status: true, brandId: true },
      }),
      db.postAnalytics.aggregate({
        where: { post: { brandId: brand.id, organizationId }, capturedAt: { gte: since30d } },
        _sum: { impressions: true, reach: true, likes: true, comments: true, shares: true, clicks: true },
        _count: { id: true },
      }),
      db.agentRun.findMany({
        where: { organizationId, status: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { id: true, title: true, kind: true, createdAt: true, output: true },
      }),
      NextActionService.computeFor(organizationId).catch(() => null),
    ]);

    const profile = brand.profile as Record<string, unknown> | null;
    const missingFields = PROFILE_FIELDS.filter((f) => !isFilled(profile?.[f.key]));
    const completeness = Math.round(
      ((PROFILE_FIELDS.length - missingFields.length) / PROFILE_FIELDS.length) * 100,
    );

    return {
      brand: {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        logo: brand.logo,
        industry: brand.industry,
        client: brand.client,
      },
      dna: { completeness, missingFields: missingFields.map((f) => f.label), hasProfile: !!profile },
      activeStrategy: activeStrategy
        ? {
            id: activeStrategy.id,
            title: activeStrategy.title,
            status: activeStrategy.status,
            itemsCount: activeStrategy._count.items,
          }
        : null,
      pendingApprovals,
      upcoming,
      inProduction,
      blocked,
      socialAccounts,
      performance30d: {
        samples: perf._count.id,
        impressions: perf._sum.impressions ?? 0,
        reach: perf._sum.reach ?? 0,
        interactions:
          (perf._sum.likes ?? 0) + (perf._sum.comments ?? 0) + (perf._sum.shares ?? 0) + (perf._sum.clicks ?? 0),
        // Honnêteté : 0 échantillon = pas de données, pas "0 performance".
        hasData: perf._count.id > 0,
      },
      agentRecommendations: lastAgentRuns,
      nextAction: nextAction?.recommended ?? null,
    };
  },
};
