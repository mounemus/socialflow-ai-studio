/**
 * NextActionService — hybrid heuristic + IA recommender for the dashboard.
 *
 * Returns the top 3 next actions the user could take to make progress in the
 * platform, with #1 framed as the "recommended" one and a French narrative.
 *
 * Pipeline:
 *   1. Gather org state in ONE Promise.all (defensively).
 *   2. Run 10 heuristic checks producing candidates with a 0-100 score.
 *   3. 0 candidates  → "Tout est en ordre…"
 *   4. 1-2 candidates → return as-is.
 *   5. 3+ candidates → take top 5 by score, ask Claude (via AIRouter
 *      TEXT_STRUCTURED_JSON) to pick the top 3 and write a 1-sentence French
 *      narrative for #1. Fall back to heuristic order if AI fails.
 *
 * Every Prisma query is wrapped: the function MUST always return SOMETHING.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { cached } from '@/lib/cache';
import { AIRouterService } from '@/services/ai/AIRouterService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NextActionSeverity = 'high' | 'medium' | 'low';

export interface NextActionCandidate {
  id: string;
  kind: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  severity: NextActionSeverity;
  heuristicScore: number; // 0-100
}

export interface RecommendedAction extends NextActionCandidate {
  narrative: string;
}

export interface NextActionResult {
  recommended: RecommendedAction;
  others: NextActionCandidate[];
  generatedAt: string;
  mocked: boolean;
}

// ---------------------------------------------------------------------------
// Defensive query helper
// ---------------------------------------------------------------------------

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn('NextActionService query failed', {
      label,
      error: (err as Error).message,
    });
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Aggregated org snapshot used by all heuristics
// ---------------------------------------------------------------------------

interface OrgSnapshot {
  brands: Array<{
    id: string;
    name: string;
    profile: {
      id: string;
      slogan: string | null;
      mission: string | null;
      toneOfVoice: string | null;
      audienceTarget: string | null;
      values: string[];
      productsServices: string[];
    } | null;
  }>;
  awaitingPipelines: Array<{
    id: string;
    step: string;
    brand: { id: string; name: string } | null;
  }>;
  strategiesWithApproved: Array<{
    brandId: string;
    brandName: string;
    approvedCount: number;
  }>;
  brandsWithBrandDna: Set<string>;
  manualNoMedia: number;
  manualNext7d: number;
  scheduledPlatformsMissingAccount: string[];
  recentPostsNoScore: number;
}

async function loadSnapshot(organizationId: string, brandId?: string | null): Promise<OrgSnapshot> {
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86_400_000);
  const past30d = new Date(now.getTime() - 30 * 86_400_000);

  const [
    brands,
    pipelinesAwaiting,
    strategyItemsApproved,
    schedulesManualNoMedia,
    schedulesManualNext7d,
    connectedAccounts,
    schedulesByPlatform,
    recentPosts,
    aiRequestsForPosts,
  ] = await Promise.all([
    safe('brands', () =>
      db.brand.findMany({
        // Marque active sélectionnée → suggestions limitées à CETTE marque
        // (une stratégie « trenkoo » ne doit plus s'afficher sous UbSkilled).
        where: { organizationId, ...(brandId ? { id: brandId } : {}) },
        select: {
          id: true,
          name: true,
          profile: {
            select: {
              id: true,
              slogan: true,
              mission: true,
              toneOfVoice: true,
              audienceTarget: true,
              values: true,
              productsServices: true,
            },
          },
        },
      }),
    [] as OrgSnapshot['brands']),

    safe('pipelinesAwaiting', () =>
      db.brandPipelineRun.findMany({
        where: {
          organizationId,
          status: 'AWAITING_ADMIN',
          ...(brandId ? { brandId } : {}),
        },
        select: {
          id: true,
          step: true,
          brand: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    [] as Array<{ id: string; step: string; brand: { id: string; name: string } | null }>),

    safe('strategyItemsApproved', () =>
      db.strategyItem.findMany({
        where: {
          status: 'APPROVED',
          strategy: { organizationId, ...(brandId ? { brandId } : {}) },
        },
        select: {
          strategyId: true,
          strategy: { select: { brandId: true, brand: { select: { id: true, name: true } } } },
        },
        take: 500,
      }),
    [] as Array<{ strategyId: string; strategy: { brandId: string; brand: { id: string; name: string } } }>),

    safe('schedulesManualNoMedia', () =>
      db.postSchedule.count({
        where: {
          post: { organizationId, media: { none: {} } },
          shareMode: 'MANUAL',
          status: 'SCHEDULED',
        },
      }),
    0),

    safe('schedulesManualNext7d', () =>
      db.postSchedule.count({
        where: {
          post: { organizationId },
          shareMode: 'MANUAL',
          status: 'SCHEDULED',
          scheduledFor: { gte: now, lte: in7d },
        },
      }),
    0),

    safe('connectedAccounts', () =>
      db.socialAccount.findMany({
        where: { organizationId, status: 'CONNECTED' },
        select: { platform: true },
      }),
    [] as Array<{ platform: string }>),

    safe('schedulesByPlatform', () =>
      db.postSchedule.findMany({
        where: {
          post: { organizationId },
          status: 'SCHEDULED',
          socialAccountId: { not: null },
        },
        select: { socialAccount: { select: { platform: true } } },
        take: 200,
      }),
    [] as Array<{ socialAccount: { platform: string } | null }>),

    safe('recentPosts', () =>
      db.post.findMany({
        where: {
          organizationId,
          status: 'PUBLISHED',
          updatedAt: { gte: past30d },
        },
        select: { id: true, metadata: true },
        take: 100,
        orderBy: { updatedAt: 'desc' },
      }),
    [] as Array<{ id: string; metadata: unknown }>),

    safe('brandDna', () =>
      db.aIRequest.findMany({
        where: {
          organizationId,
          metadata: { path: ['kind'], equals: 'brand_dna_extract' },
        },
        select: { metadata: true },
        take: 100,
      }),
    [] as Array<{ metadata: unknown }>),
  ]);

  // Aggregate approved-but-not-executed items grouped by brand
  const approvedByBrand = new Map<string, { brandName: string; count: number }>();
  for (const item of strategyItemsApproved) {
    const brand = item.strategy?.brand;
    if (!brand?.id) continue;
    const entry = approvedByBrand.get(brand.id) ?? { brandName: brand.name, count: 0 };
    entry.count += 1;
    approvedByBrand.set(brand.id, entry);
  }
  const strategiesWithApproved: OrgSnapshot['strategiesWithApproved'] = [];
  for (const [brandId, entry] of approvedByBrand.entries()) {
    strategiesWithApproved.push({ brandId, brandName: entry.brandName, approvedCount: entry.count });
  }

  // Brand DNA presence
  const brandsWithBrandDna = new Set<string>();
  for (const req of aiRequestsForPosts) {
    const meta = req.metadata as { brandId?: string } | null;
    if (meta?.brandId) brandsWithBrandDna.add(meta.brandId);
  }

  // Platforms used in schedules but missing CONNECTED account
  const connectedSet = new Set(connectedAccounts.map((a) => a.platform));
  const scheduledPlatforms = new Set<string>();
  for (const s of schedulesByPlatform) {
    if (s.socialAccount?.platform) scheduledPlatforms.add(s.socialAccount.platform);
  }
  const scheduledPlatformsMissingAccount: string[] = [];
  for (const p of scheduledPlatforms) {
    if (!connectedSet.has(p)) scheduledPlatformsMissingAccount.push(p);
  }

  // Recent posts with no score (metadata.score absent)
  let recentPostsNoScore = 0;
  for (const post of recentPosts) {
    const meta = (post.metadata ?? {}) as { score?: unknown; postScore?: unknown };
    if (meta.score === undefined && meta.postScore === undefined) recentPostsNoScore += 1;
  }

  return {
    brands,
    awaitingPipelines: pipelinesAwaiting,
    strategiesWithApproved,
    brandsWithBrandDna,
    manualNoMedia: schedulesManualNoMedia,
    manualNext7d: schedulesManualNext7d,
    scheduledPlatformsMissingAccount,
    recentPostsNoScore,
  };
}

// ---------------------------------------------------------------------------
// Heuristic check pipeline
// ---------------------------------------------------------------------------

function buildCandidates(snapshot: OrgSnapshot): NextActionCandidate[] {
  const candidates: NextActionCandidate[] = [];

  // 1. No brand exists
  if (snapshot.brands.length === 0) {
    candidates.push({
      id: 'no_brand',
      kind: 'BRAND_CREATE',
      title: 'Crée ta première marque',
      description: "Aucune marque n'existe pour ton organisation — commence par en créer une pour activer tout l'écosystème.",
      ctaLabel: 'Créer une marque',
      ctaHref: '/brands/new',
      severity: 'high',
      heuristicScore: 100,
    });
    // If no brand, nothing else matters — short circuit later checks.
    return candidates;
  }

  // 2. Brand exists but no BrandProfile filled
  for (const brand of snapshot.brands) {
    const p = brand.profile;
    const filled = !!p && (
      !!p.slogan || !!p.mission || !!p.toneOfVoice || !!p.audienceTarget ||
      (p.values?.length ?? 0) > 0 || (p.productsServices?.length ?? 0) > 0
    );
    if (!filled) {
      candidates.push({
        id: `brand_profile:${brand.id}`,
        kind: 'BRAND_PROFILE_FILL',
        title: `Enrichis le profil de ${brand.name}`,
        description: `Le profil de ${brand.name} est vide — sans contexte, les générations IA seront génériques.`,
        ctaLabel: 'Compléter le profil',
        ctaHref: `/brands/${brand.id}`,
        severity: 'high',
        heuristicScore: 92,
      });
      break; // one is enough to surface
    }
  }

  // 3. Pipeline waiting at admin gate
  for (const p of snapshot.awaitingPipelines) {
    const brandLabel = p.brand?.name ?? 'une marque';
    const stepLabel = p.step === 'VALIDATE_PROFILE' ? 'le profil'
      : p.step === 'VALIDATE_STRATEGY_ITEMS' ? 'la stratégie'
      : 'le pipeline';
    candidates.push({
      id: `pipeline_admin:${p.id}`,
      kind: 'PIPELINE_VALIDATE',
      title: `Valide ${stepLabel} en attente sur ${brandLabel}`,
      description: `Un pipeline est bloqué en attente de validation admin sur ${brandLabel}.`,
      ctaLabel: 'Ouvrir le pipeline',
      ctaHref: `/pipelines/${p.id}`,
      severity: 'high',
      heuristicScore: 95,
    });
    break;
  }

  // 4. Strategy items APPROVED but not yet EXECUTED
  for (const s of snapshot.strategiesWithApproved) {
    if (s.approvedCount > 0) {
      candidates.push({
        id: `strategy_execute:${s.brandId}`,
        kind: 'STRATEGY_EXECUTE',
        title: `Exécute les ${s.approvedCount} items approuvés de ${s.brandName}`,
        description: `${s.approvedCount} idées validées attendent d'être transformées en posts/campagnes pour ${s.brandName}.`,
        ctaLabel: 'Exécuter la stratégie',
        ctaHref: `/brands/${s.brandId}/strategy`,
        severity: 'medium',
        heuristicScore: 80,
      });
      break;
    }
  }

  // 5. Posts SCHEDULED with shareMode=MANUAL and no media yet
  if (snapshot.manualNoMedia > 0) {
    candidates.push({
      id: 'visuals_pending',
      kind: 'VISUALS_PRODUCE',
      title: `Produis les visuels pour ${snapshot.manualNoMedia} post${snapshot.manualNoMedia > 1 ? 's' : ''} en attente`,
      description: `${snapshot.manualNoMedia} post${snapshot.manualNoMedia > 1 ? 's sont' : ' est'} programmé${snapshot.manualNoMedia > 1 ? 's' : ''} sans visuel — génère-les avant la date de publication.`,
      ctaLabel: 'Ouvrir le calendrier',
      ctaHref: '/calendar',
      severity: 'medium',
      heuristicScore: 75,
    });
  }

  // 6. Posts SCHEDULED in next 7 days with shareMode=MANUAL
  if (snapshot.manualNext7d > 0) {
    candidates.push({
      id: 'manual_share_week',
      kind: 'MANUAL_SHARE_WEEK',
      title: `${snapshot.manualNext7d} post${snapshot.manualNext7d > 1 ? 's' : ''} à partager cette semaine`,
      description: `Tu as ${snapshot.manualNext7d} publication${snapshot.manualNext7d > 1 ? 's' : ''} manuelle${snapshot.manualNext7d > 1 ? 's' : ''} prévue${snapshot.manualNext7d > 1 ? 's' : ''} d'ici 7 jours.`,
      ctaLabel: 'Voir le calendrier',
      ctaHref: '/calendar',
      severity: 'medium',
      heuristicScore: 70,
    });
  }

  // 7. No SocialAccount connected for a platform with scheduled posts
  if (snapshot.scheduledPlatformsMissingAccount.length > 0) {
    const platform = snapshot.scheduledPlatformsMissingAccount[0];
    candidates.push({
      id: `connect_platform:${platform}`,
      kind: 'SOCIAL_CONNECT',
      title: `Connecte ${platform} pour activer la publication auto`,
      description: `Des posts sont planifiés sur ${platform} mais aucun compte CONNECTED — ils ne pourront pas se publier.`,
      ctaLabel: 'Connecter un compte',
      ctaHref: '/social-accounts',
      severity: 'high',
      heuristicScore: 85,
    });
  }

  // 8. Brand has Strategy but no BrandDNA extracted
  for (const s of snapshot.strategiesWithApproved) {
    if (!snapshot.brandsWithBrandDna.has(s.brandId)) {
      candidates.push({
        id: `brand_dna:${s.brandId}`,
        kind: 'BRAND_DNA_EXTRACT',
        title: `Extrais l'ADN de ${s.brandName} pour cohérence des générations`,
        description: `Sans BrandDNA, chaque génération IA repart de zéro — extrais-le pour verrouiller le ton de ${s.brandName}.`,
        ctaLabel: 'Lancer l\'extraction',
        ctaHref: `/intelligence?brandId=${s.brandId}`,
        severity: 'low',
        heuristicScore: 55,
      });
      break;
    }
  }

  // 9. Recent posts with no score
  if (snapshot.recentPostsNoScore >= 3) {
    candidates.push({
      id: 'score_recent_posts',
      kind: 'POSTS_SCORE',
      title: 'Score tes posts récents pour identifier les améliorations',
      description: `${snapshot.recentPostsNoScore} posts publiés récemment n'ont pas de score — l'analyse révèle ce qui marche.`,
      ctaLabel: 'Ouvrir Intelligence',
      ctaHref: '/intelligence',
      severity: 'low',
      heuristicScore: 50,
    });
  }

  // 10. Brands exist (with filled profile) but no strategy/pipeline yet — most common
  //     state right after onboarding. Recommend a concrete next step, not a vague
  //     "all green" message.
  if (candidates.length === 0) {
    const firstBrand = snapshot.brands[0];
    if (firstBrand && snapshot.strategiesWithApproved.length === 0 && snapshot.awaitingPipelines.length === 0) {
      candidates.push({
        id: `start_strategy:${firstBrand.id}`,
        kind: 'STRATEGY_START',
        title: `Génère la stratégie marketing de ${firstBrand.name}`,
        description: `${firstBrand.name} a un profil — l'étape suivante est de générer une stratégie complète avec 10-30 items prêts à produire.`,
        ctaLabel: 'Démarrer un pipeline',
        ctaHref: '/pipelines/new',
        severity: 'medium',
        heuristicScore: 70,
      });
    } else {
      candidates.push({
        id: 'all_green',
        kind: 'ALL_GREEN',
        title: 'Tout est aligné — lance la prochaine itération',
        description: 'Pas d\'action critique en attente. Démarre un nouveau pipeline ou explore les insights.',
        ctaLabel: 'Démarrer un pipeline',
        ctaHref: '/pipelines/new',
        severity: 'low',
        heuristicScore: 30,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// AI ranking (optional polish on top of heuristics)
// ---------------------------------------------------------------------------

interface AiRanking {
  top3Ids: string[];
  narrative: string;
}

async function aiRankTop3(top5: NextActionCandidate[]): Promise<AiRanking | null> {
  const prompt = `Tu es l'assistant stratégique d'un SaaS marketing IA. Tu reçois ${top5.length} actions candidates qu'un utilisateur pourrait prendre maintenant. Choisis les 3 plus impactantes dans l'ordre, et écris 1 phrase en français qui explique pourquoi l'action #1 est la plus prioritaire.

Candidates JSON:
${JSON.stringify(top5.map((c) => ({ id: c.id, kind: c.kind, title: c.title, description: c.description, severity: c.severity, score: c.heuristicScore })), null, 2)}

Réponds STRICTEMENT en JSON valide avec ce schéma exact:
{"top3Ids": ["id1","id2","id3"], "narrative": "Une phrase en français expliquant pourquoi #1."}`;

  try {
    const result = await AIRouterService.generateTextForTask('TEXT_STRUCTURED_JSON', {
      prompt,
      maxTokens: 400,
      temperature: 0.2,
    });

    if (!result?.text) return null;
    const cleaned = result.text
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned) as { top3Ids?: unknown; narrative?: unknown };
    if (!Array.isArray(parsed.top3Ids) || typeof parsed.narrative !== 'string') return null;
    const top3Ids = parsed.top3Ids.filter((x): x is string => typeof x === 'string').slice(0, 3);
    if (top3Ids.length === 0) return null;
    return { top3Ids, narrative: parsed.narrative };
  } catch (err) {
    logger.warn('NextActionService AI ranking failed', { error: (err as Error).message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const NextActionService = {
  /**
   * Compute the dashboard next-action recommendation for an org.
   *
   * Cached for 60s per org (advisory): the whole result — heavy snapshot
   * queries AND the advisory AI ranking — is reused so repeated dashboard
   * loads within the window don't re-run the gather + AI call. The key is
   * scoped to `organizationId` so tenants never share a result. Best-effort,
   * per-instance (see src/lib/cache.ts).
   */
  computeFor(organizationId: string, brandId?: string | null): Promise<NextActionResult> {
    // Le brandId fait partie de la clé : la marque active change → cache distinct.
    return cached(`nextaction:${organizationId}:${brandId ?? 'all'}`, 60_000, () =>
      this._computeForUncached(organizationId, brandId),
    );
  },

  async _computeForUncached(organizationId: string, brandId?: string | null): Promise<NextActionResult> {
    const generatedAt = new Date().toISOString();

    // 1. Snapshot (always returns SOMETHING, even if all queries fail)
    const snapshot = await safe(
      'snapshot',
      () => loadSnapshot(organizationId, brandId),
      {
        brands: [],
        awaitingPipelines: [],
        strategiesWithApproved: [],
        brandsWithBrandDna: new Set<string>(),
        manualNoMedia: 0,
        manualNext7d: 0,
        scheduledPlatformsMissingAccount: [],
        recentPostsNoScore: 0,
      } as OrgSnapshot,
    );

    // 2. Heuristic candidates
    const candidates = buildCandidates(snapshot)
      .sort((a, b) => b.heuristicScore - a.heuristicScore);

    // 3. Always have at least one
    if (candidates.length === 0) {
      const fallback: RecommendedAction = {
        id: 'explore_assistant',
        kind: 'EXPLORE_ASSISTANT',
        title: "Tout est en ordre — explore l'Assistant IA",
        description: "Aucune action critique détectée — discute avec l'assistant pour préparer la suite.",
        ctaLabel: "Ouvrir l'Assistant",
        ctaHref: '/assistant',
        severity: 'low',
        heuristicScore: 10,
        narrative: "Aucun goulet d'étranglement détecté — bon moment pour explorer l'Assistant IA et préparer la prochaine étape.",
      };
      return { recommended: fallback, others: [], generatedAt, mocked: true };
    }

    // 4. 1-2 candidates → return as-is
    if (candidates.length <= 2) {
      const [first, ...rest] = candidates;
      return {
        recommended: {
          ...first,
          narrative: `Priorité immédiate : ${first.title.toLowerCase()} pour débloquer la suite.`,
        },
        others: rest,
        generatedAt,
        mocked: false,
      };
    }

    // 5. 3+ candidates → top 5 to AI for ranking + narrative
    const top5 = candidates.slice(0, 5);
    const ai = await aiRankTop3(top5);

    if (ai) {
      const byId = new Map(top5.map((c) => [c.id, c]));
      const ordered: NextActionCandidate[] = [];
      for (const id of ai.top3Ids) {
        const c = byId.get(id);
        if (c && !ordered.find((o) => o.id === c.id)) ordered.push(c);
      }
      // Fill missing slots from heuristic order if AI dropped some
      for (const c of top5) {
        if (ordered.length >= 3) break;
        if (!ordered.find((o) => o.id === c.id)) ordered.push(c);
      }
      const [first, ...rest] = ordered;
      return {
        recommended: { ...first, narrative: ai.narrative },
        others: rest.slice(0, 2),
        generatedAt,
        mocked: false,
      };
    }

    // Fallback to heuristic order
    const [first, second, third] = top5;
    return {
      recommended: {
        ...first,
        narrative: `Priorité immédiate : ${first.title.toLowerCase()} pour débloquer la suite.`,
      },
      others: [second, third].filter(Boolean),
      generatedAt,
      mocked: false,
    };
  },
};
