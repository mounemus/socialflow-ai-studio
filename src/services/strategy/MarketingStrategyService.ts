/**
 * MarketingStrategyService — generates a complete digital marketing strategy
 * with Claude (best for strategic reasoning), then breaks it down into
 * actionable items that can be turned into real Posts/Campaigns.
 *
 * Workflow:
 *   1. generateStrategy(brandId) -> structured strategy + items (DRAFT)
 *   2. user reviews on /brands/[id]/strategy
 *   3. validateStrategy(strategyId) -> status=VALIDATED
 *   4. user approves/rejects individual items
 *   5. executeItem(itemId) -> creates real Post/Campaign with link back
 */
import { db } from '@/lib/db';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { learnedStrategyBlock } from '@/services/watch/learning';
import { logger } from '@/lib/logger';

export interface StrategyStructure {
  executive_summary: string;
  current_situation: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  target_audience: { primary: string; secondary?: string; personas: Array<{ name: string; description: string }> };
  positioning: { unique_value: string; differentiation: string[]; brand_promise: string };
  objectives: Array<{ horizon: '30d' | '90d' | '12mo'; kpi: string; target: string; rationale: string }>;
  content_pillars: Array<{ name: string; description: string; weight_pct: number; examples: string[] }>;
  channels: Array<{ platform: string; role: string; frequency: string; format_focus: string[] }>;
  campaigns: Array<{ name: string; period: string; objective: string; channels: string[]; key_message: string }>;
  experiments: string[];
  risks_mitigation: Array<{ risk: string; mitigation: string }>;
  budget_split: Record<string, string>;
}

export interface GeneratedItem {
  kind: 'CONTENT_PILLAR' | 'POST_IDEA' | 'CAMPAIGN_IDEA' | 'AD_IDEA' | 'EMAIL_IDEA' | 'REEL_IDEA' | 'EXPERIMENT' | 'PARTNERSHIP' | 'MILESTONE';
  title: string;
  description: string;
  platform?: string;
  format?: string;
  suggestedDate?: string;
  hashtags?: string[];
  cta?: string;
}

export const MarketingStrategyService = {
  /**
   * Generate a strategy + actionable items for a brand.
   * Uses Claude for the strategic reasoning (TEXT_STRATEGIC routing).
   */
  async generate(opts: {
    organizationId: string;
    brandId: string;
    horizon?: '30d' | '90d' | '12mo';
    additionalContext?: string;
  }): Promise<{ strategy: StrategyStructure; items: GeneratedItem[]; mocked: boolean; mockReason?: 'ai_unavailable' | 'parse_failed' }> {
    const brand = await db.brand.findFirst({
      where: { id: opts.brandId, organizationId: opts.organizationId },
      include: { profile: true, socialAccounts: true, competitors: true },
    });
    if (!brand) throw new Error('Brand not found');

    const horizon = opts.horizon ?? '90d';

    const brandContext = [
      `Marque: ${brand.name}`,
      brand.industry ? `Industrie: ${brand.industry}` : null,
      brand.description ? `Description: ${brand.description}` : null,
      brand.profile?.slogan ? `Slogan: ${brand.profile.slogan}` : null,
      brand.profile?.mission ? `Mission: ${brand.profile.mission}` : null,
      brand.profile?.audienceTarget ? `Audience cible: ${brand.profile.audienceTarget}` : null,
      brand.profile?.toneOfVoice ? `Ton: ${brand.profile.toneOfVoice}` : null,
      brand.profile?.wordsToUse?.length ? `Mots à utiliser: ${brand.profile.wordsToUse.join(', ')}` : null,
      brand.profile?.wordsToAvoid?.length ? `Mots à éviter: ${brand.profile.wordsToAvoid.join(', ')}` : null,
      brand.profile?.officialHashtags?.length ? `Hashtags: ${brand.profile.officialHashtags.join(' ')}` : null,
      brand.socialAccounts.length > 0 ? `Plateformes actives: ${brand.socialAccounts.map((s) => s.platform).join(', ')}` : 'Aucune plateforme connectée',
      brand.competitors.length > 0 ? `Concurrents suivis: ${brand.competitors.map((c) => c.name).join(', ')}` : null,
      opts.additionalContext ? `Contexte additionnel: ${opts.additionalContext}` : null,
    ].filter(Boolean).join('\n') + (await learnedStrategyBlock(opts.organizationId, opts.brandId));

    const systemPrompt = `Tu es un Directeur Marketing Stratégique senior (20+ ans d'expérience).
Tu vas produire une stratégie marketing digital COMPLÈTE et ACTIONNABLE pour une marque, avec un horizon de ${horizon}.

Tu réponds en JSON STRICT — pas de texte avant/après. Le JSON doit avoir EXACTEMENT cette structure:

{
  "strategy": {
    "executive_summary": "3-5 phrases synthétisant la stratégie globale",
    "current_situation": {
      "strengths": ["4-6 forces"],
      "weaknesses": ["3-5 faiblesses"],
      "opportunities": ["4-6 opportunités"],
      "threats": ["3-5 menaces"]
    },
    "target_audience": {
      "primary": "audience primaire détaillée",
      "secondary": "audience secondaire optionnelle",
      "personas": [
        { "name": "nom du persona", "description": "description précise: démographique, psychographique, comportement, douleurs, désirs" }
      ]
    },
    "positioning": {
      "unique_value": "proposition de valeur unique",
      "differentiation": ["3-5 différenciateurs concrets"],
      "brand_promise": "promesse de marque en 1 phrase"
    },
    "objectives": [
      { "horizon": "30d|90d|12mo", "kpi": "nom du KPI", "target": "valeur cible mesurable", "rationale": "pourquoi cet objectif" }
    ],
    "content_pillars": [
      { "name": "nom du pilier", "description": "description", "weight_pct": 25, "examples": ["3 exemples concrets de contenu"] }
    ],
    "channels": [
      { "platform": "INSTAGRAM|LINKEDIN|...", "role": "rôle dans le mix", "frequency": "ex: 3 posts/semaine", "format_focus": ["Reels", "Carrousels"] }
    ],
    "campaigns": [
      { "name": "nom de campagne", "period": "ex: Mois 1", "objective": "objectif", "channels": ["INSTAGRAM"], "key_message": "message clé" }
    ],
    "experiments": ["3-5 expérimentations à tester"],
    "risks_mitigation": [
      { "risk": "risque identifié", "mitigation": "comment l'atténuer" }
    ],
    "budget_split": { "content_production": "%", "paid_media": "%", "tools": "%", "influencers": "%" }
  },
  "items": [
    // 15-25 items CONCRETS et ACTIONNABLES — chacun deviendra un vrai post/campagne
    { "kind": "POST_IDEA", "title": "titre court", "description": "brief de 2-3 phrases pour un post précis", "platform": "INSTAGRAM", "format": "INSTAGRAM_POST", "suggestedDate": "ISO date", "hashtags": ["#x"], "cta": "Découvre →" },
    { "kind": "CAMPAIGN_IDEA", "title": "...", "description": "...", "platform": null, "format": null },
    { "kind": "REEL_IDEA", "title": "...", "description": "script 30s + hook + CTA", "platform": "INSTAGRAM", "format": "INSTAGRAM_REEL" },
    { "kind": "AD_IDEA", "title": "...", "description": "concept + audience cible + budget suggéré" },
    { "kind": "EMAIL_IDEA", "title": "...", "description": "subject + concept" },
    { "kind": "EXPERIMENT", "title": "...", "description": "hypothèse + test + KPI" },
    { "kind": "PARTNERSHIP", "title": "...", "description": "type de partenariat + cibles" },
    { "kind": "CONTENT_PILLAR", "title": "nom pilier", "description": "pourquoi + comment" }
  ]
}

Règles:
- Sois EXTRÊMEMENT spécifique à la marque fournie (pas générique)
- Mentionne les concurrents identifiés quand pertinent
- Les dates suggérées doivent être dans les ${horizon === '30d' ? '30' : horizon === '90d' ? '90' : '365'} jours à venir
- Les KPIs doivent être mesurables (chiffres, %)
- Items: mix de quick wins (semaine 1-2) et de leviers structurels (mois 2-3)`;

    const userPrompt = `Génère la stratégie marketing digital complète pour cette marque:

${brandContext}

Horizon: ${horizon}.

Sois concret, spécifique, mesurable. Pense comme un consultant senior qui rendrait ce livrable à un client.`;

    const result = await AIRouterService.generateTextForTask('TEXT_STRATEGIC', {
      prompt: userPrompt,
      systemPrompt,
      // 6000 tronquait la réponse sur les gros briefs (plan 30 pages) → JSON
      // invalide → mock. Sonnet écrit ~70 tok/s : 12k reste sous les 300s.
      maxTokens: 12000,
      temperature: 0.7,
    });

    let parsed: { strategy: StrategyStructure; items: GeneratedItem[] } | null =
      extractJson<{ strategy: StrategyStructure; items: GeneratedItem[] }>(result.text);
    if (parsed && (!parsed.strategy || !Array.isArray(parsed.items))) parsed = null;
    if (!parsed) {
      logger.warn('Strategy parse failed', {
        // Sans un extrait de la réponse, impossible de savoir POURQUOI le
        // JSON est invalide (troncature, prose autour, refus du modèle…).
        provider: result.provider,
        textLength: result.text?.length ?? 0,
        head: (result.text ?? '').slice(0, 300),
        tail: (result.text ?? '').slice(-300),
      });
    }

    // Vérité opérationnelle : une stratégie simulée ne doit JAMAIS être servie
    // comme une vraie. Avant, l'échec de parsing basculait silencieusement sur
    // `mockStrategy` tout en laissant `mocked: result.mocked` à false — l'UI
    // affichait donc « Modèle : claude » sur un contenu inventé localement.
    let mocked = result.mocked;
    let mockReason: 'ai_unavailable' | 'parse_failed' | undefined = result.mocked ? 'ai_unavailable' : undefined;
    if (!parsed) {
      logger.warn('Strategy: bascule sur le contenu simulé (parsing impossible)', {
        provider: result.provider,
        brand: brand.name,
      });
      parsed = mockStrategy(brand.name, brand.industry ?? 'general', horizon);
      if (!mocked) mockReason = 'parse_failed';
      mocked = true;
    }

    return {
      strategy: parsed.strategy,
      items: parsed.items,
      mocked,
      mockReason,
    };
  },

  /**
   * Persist a generated strategy + its items into the DB as DRAFT.
   */
  async save(opts: {
    organizationId: string;
    brandId: string;
    horizon: string;
    title: string;
    strategy: StrategyStructure;
    items: GeneratedItem[];
    generatedByModel?: string;
  }) {
    return db.marketingStrategy.create({
      data: {
        organizationId: opts.organizationId,
        brandId: opts.brandId,
        title: opts.title,
        horizon: opts.horizon,
        strategy: opts.strategy as never,
        generatedByModel: opts.generatedByModel,
        items: {
          create: opts.items.map((item, idx) => ({
            order: idx,
            kind: item.kind,
            title: item.title,
            description: item.description,
            platform: item.platform,
            format: item.format,
            suggestedDate: item.suggestedDate ? new Date(item.suggestedDate) : null,
            hashtags: item.hashtags ?? [],
            cta: item.cta,
            metadata: {} as never,
          })),
        },
      },
      include: { items: true },
    });
  },

  /**
   * Execute an approved item: create the real Post or Campaign + auto-schedule if possible.
   * Returns IDs + a 'nextStep' hint for the UI (route to AI Studio for content design).
   */
  async executeItem(itemId: string, organizationId: string, userId: string) {
    const item = await db.strategyItem.findUnique({
      where: { id: itemId },
      include: { strategy: { include: { brand: true } } },
    });
    if (!item) throw new Error('Item not found');
    if (item.strategy.organizationId !== organizationId) throw new Error('Forbidden');
    if (item.status === 'EXECUTED') return { alreadyExecuted: true, postId: item.postId, campaignId: item.campaignId, scheduleId: null, nextStep: null };

    const isContentItem = ['POST_IDEA', 'REEL_IDEA', 'EMAIL_IDEA'].includes(item.kind);
    const isCampaignItem = ['CAMPAIGN_IDEA', 'AD_IDEA'].includes(item.kind);

    let postId: string | undefined;
    let campaignId: string | undefined;
    let scheduleId: string | undefined;
    const warnings: string[] = [];

    if (isContentItem) {
      const formatMap: Record<string, string> = {
        POST_IDEA: 'INSTAGRAM_POST',
        REEL_IDEA: 'INSTAGRAM_REEL',
        EMAIL_IDEA: 'EMAIL_MARKETING',
      };
      const post = await db.post.create({
        data: {
          organizationId,
          authorId: userId,
          brandId: item.strategy.brandId,
          status: 'DRAFT',
          format: (item.format ?? formatMap[item.kind] ?? 'INSTAGRAM_POST') as never,
          language: 'fr',
          title: item.title,
          body: item.description,
          hashtags: item.hashtags,
          cta: item.cta,
          metadata: { fromStrategyItem: itemId, kind: item.kind } as never,
        },
      });
      postId = post.id;

      // === AUTO-SCHEDULE ===
      // ALWAYS create a PostSchedule when suggestedDate exists. If a matching SocialAccount
      // exists → shareMode='AUTO' (will be published by the publisher). Otherwise →
      // shareMode='MANUAL' (user shares from the calendar with native share / download).
      // Falls back to "tomorrow at 10am" if no suggestedDate so EVERY executed item lands
      // on the calendar — the user can drag-drop to reprogram.
      const scheduledFor = item.suggestedDate
        ?? new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow same time as fallback

      const account = item.platform ? await db.socialAccount.findFirst({
        where: {
          organizationId,
          platform: item.platform as never,
          OR: [{ brandId: item.strategy.brandId }, { brandId: null }],
        },
        orderBy: { brandId: 'desc' }, // brand-bound first
      }) : null;

      const shareMode = account ? 'AUTO' : 'MANUAL';
      const schedule = await db.postSchedule.create({
        data: {
          postId: post.id,
          socialAccountId: account?.id ?? null,
          scheduledFor,
          shareMode,
        },
      });
      scheduleId = schedule.id;
      await db.post.update({ where: { id: post.id }, data: { status: 'SCHEDULED' } });

      if (!item.suggestedDate) {
        warnings.push('Pas de date suggérée — placé demain par défaut, drag-drop sur le calendrier pour ajuster.');
      }
      if (!account && item.platform) {
        warnings.push(`Aucun compte ${item.platform} connecté — partage manuel depuis le calendrier (badge orange).`);
      } else if (!item.platform) {
        warnings.push('Pas de plateforme définie — partage manuel depuis le calendrier.');
      }
    } else if (isCampaignItem) {
      const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) + '-' + Date.now();
      const campaign = await db.campaign.create({
        data: {
          organizationId,
          brandId: item.strategy.brandId,
          name: item.title,
          slug,
          objective: item.description,
          status: 'DRAFT',
          metadata: { fromStrategyItem: itemId, kind: item.kind } as never,
        },
      });
      campaignId = campaign.id;
    }

    const updated = await db.strategyItem.update({
      where: { id: itemId },
      data: {
        status: 'EXECUTED',
        postId,
        campaignId,
      },
    });

    // === Next step hint for UI ===
    // For content items, route to AI Studio to design/enrich the content
    const nextStep = postId
      ? { type: 'studio', url: `/studio?postId=${postId}`, label: 'Développer le contenu dans le Studio' }
      : campaignId
      ? { type: 'campaign', url: `/campaigns`, label: 'Voir la campagne' }
      : null;

    return { item: updated, postId, campaignId, scheduleId, warnings, nextStep, alreadyExecuted: false };
  },

  /**
   * Approve / reject an item.
   */
  async updateItemStatus(itemId: string, organizationId: string, status: 'APPROVED' | 'REJECTED' | 'PROPOSED') {
    const item = await db.strategyItem.findUnique({
      where: { id: itemId },
      include: { strategy: true },
    });
    if (!item || item.strategy.organizationId !== organizationId) throw new Error('Not found');
    return db.strategyItem.update({ where: { id: itemId }, data: { status } });
  },

  /**
   * Edit item fields (title, description, platform, format, etc.)
   */
  async updateItemContent(itemId: string, organizationId: string, patch: {
    title?: string;
    description?: string;
    platform?: string | null;
    format?: string | null;
    suggestedDate?: string | null;
    hashtags?: string[];
    cta?: string | null;
  }) {
    const item = await db.strategyItem.findUnique({
      where: { id: itemId },
      include: { strategy: true },
    });
    if (!item || item.strategy.organizationId !== organizationId) throw new Error('Not found');
    if (item.status === 'EXECUTED') throw new Error('Cannot edit an executed item');

    return db.strategyItem.update({
      where: { id: itemId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.platform !== undefined ? { platform: patch.platform } : {}),
        ...(patch.format !== undefined ? { format: patch.format } : {}),
        ...(patch.suggestedDate !== undefined ? { suggestedDate: patch.suggestedDate ? new Date(patch.suggestedDate) : null } : {}),
        ...(patch.hashtags !== undefined ? { hashtags: patch.hashtags } : {}),
        ...(patch.cta !== undefined ? { cta: patch.cta } : {}),
      },
    });
  },

  /**
   * Regenerate a single item via AI, keeping the same kind + context.
   * Useful when the user doesn't like the proposed idea but wants another in the same slot.
   */
  async regenerateItem(itemId: string, organizationId: string, extraInstruction?: string) {
    const item = await db.strategyItem.findUnique({
      where: { id: itemId },
      include: { strategy: { include: { brand: { include: { profile: true } } } } },
    });
    if (!item || item.strategy.organizationId !== organizationId) throw new Error('Not found');
    if (item.status === 'EXECUTED') throw new Error('Cannot regenerate an executed item');

    const brand = item.strategy.brand;
    // Build context from the strategy + sibling items so the new proposal is coherent
    const otherItems = await db.strategyItem.findMany({
      where: { strategyId: item.strategyId, NOT: { id: itemId } },
      orderBy: { order: 'asc' },
      take: 20,
    });

    const systemPrompt = `Tu es un Directeur Marketing Stratégique senior. Tu vas REGÉNÉRER UN SEUL item d'un plan d'action marketing, en restant cohérent avec les autres items du même plan.

Réponds UNIQUEMENT en JSON STRICT (pas de texte avant/après), avec EXACTEMENT cette structure:
{
  "title": "titre court et accrocheur",
  "description": "description précise 2-3 phrases — brief actionnable",
  "platform": "INSTAGRAM|FACEBOOK|LINKEDIN|TWITTER|TIKTOK|YOUTUBE|PINTEREST|null",
  "format": "INSTAGRAM_POST|INSTAGRAM_REEL|... ou null",
  "suggestedDate": "ISO date string ou null",
  "hashtags": ["#tag1", "#tag2"],
  "cta": "appel à l'action court ou null"
}`;

    const userPrompt = `Marque: ${brand.name}
Industrie: ${brand.industry ?? 'N/A'}
Ton: ${brand.profile?.toneOfVoice ?? 'N/A'}

Type d'item à régénérer: ${item.kind}
Item actuel (à remplacer par quelque chose de différent mais cohérent):
- Titre: ${item.title}
- Description: ${item.description}
- Plateforme: ${item.platform ?? '?'}
- Format: ${item.format ?? '?'}

Autres items du plan (pour rester cohérent et NE PAS dupliquer):
${otherItems.map((i, n) => `${n + 1}. [${i.kind}] ${i.title} — ${i.description.slice(0, 100)}`).join('\n')}

${extraInstruction ? `Instruction spécifique de l'utilisateur: ${extraInstruction}` : 'Génère une alternative ORIGINALE et BIEN différente.'}

Sois concret, actionnable, mesurable. Réponds en JSON valide.`;

    const result = await AIRouterService.generateTextForTask('TEXT_STRATEGIC', {
      prompt: userPrompt,
      systemPrompt,
      maxTokens: 800,
      temperature: 0.9, // higher creativity for alternatives
    });

    let parsed = extractJson<{
      title?: string; description?: string; platform?: string | null;
      format?: string | null; suggestedDate?: string | null; hashtags?: string[]; cta?: string | null;
    }>(result.text);

    if (!parsed) {
      // Fallback mock variant
      parsed = {
        title: `[MOCK regen] ${item.title} — variante`,
        description: `${item.description}\n\n[Variante mock — configure ENABLE_REAL_AI=true pour de vraies alternatives]`,
        platform: item.platform,
        format: item.format,
        suggestedDate: item.suggestedDate?.toISOString() ?? null,
        hashtags: item.hashtags,
        cta: item.cta,
      };
    }

    const updated = await db.strategyItem.update({
      where: { id: itemId },
      data: {
        title: parsed.title ?? item.title,
        description: parsed.description ?? item.description,
        platform: parsed.platform === null ? null : (parsed.platform ?? item.platform),
        format: parsed.format === null ? null : (parsed.format ?? item.format),
        suggestedDate: parsed.suggestedDate ? new Date(parsed.suggestedDate) : item.suggestedDate,
        hashtags: parsed.hashtags ?? item.hashtags,
        cta: parsed.cta === null ? null : (parsed.cta ?? item.cta),
        status: 'PROPOSED', // reset status on regen
      },
    });

    return { item: updated, mocked: result.mocked };
  },
};

/**
 * Extrait le premier objet JSON d'une réponse LLM, en réparant les sorties
 * tronquées (coupées à maxTokens) : on retombe sur la dernière valeur complète
 * puis on referme les chaînes/objets/tableaux restés ouverts.
 */
export function extractJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  const start = raw.indexOf('{');
  if (start < 0) return null;
  const src = raw.slice(start);

  try { return JSON.parse(src.slice(0, src.lastIndexOf('}') + 1)) as T; } catch { /* tenter la réparation */ }

  // Tronqué : couper au dernier séparateur de valeur complète, puis refermer.
  const lastGood = Math.max(src.lastIndexOf('},'), src.lastIndexOf('],'), src.lastIndexOf('}'), src.lastIndexOf(']'));
  if (lastGood < 0) return null;
  let s = src.slice(0, lastGood + 1).replace(/,\s*$/, '');

  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) s += '"';
  s = s.replace(/,\s*$/, '');
  while (stack.length) s += stack.pop();

  try { return JSON.parse(s) as T; } catch { return null; }
}

function mockStrategy(brandName: string, industry: string, horizon: string): { strategy: StrategyStructure; items: GeneratedItem[] } {
  return {
    strategy: {
      executive_summary: `[MOCK] Stratégie ${horizon} pour ${brandName} (${industry}): renforcer la notoriété via Instagram + LinkedIn, lancer 2 campagnes signature, et tester 3 expérimentations data-driven.`,
      current_situation: {
        strengths: ['Marque jeune et agile', 'Positionnement clair', 'Communauté engagée'],
        weaknesses: ['Présence sociale limitée', 'Pas de paid media actif', 'Analytics manuels'],
        opportunities: ['Niche peu saturée', 'Tendance vidéo courte', 'IA générative démocratisée'],
        threats: ['Concurrents lèvent des fonds', 'Algorithmes en évolution rapide'],
      },
      target_audience: {
        primary: 'Adultes 25-45 ans urbains, sensibles au design et à l\'innovation',
        personas: [
          { name: 'Alex le créatif', description: 'Designer 30 ans, vit en ville, suit Apple/Vitra/Muji, valorise la qualité et l\'esthétique épurée' },
          { name: 'Marie l\'early adopter', description: 'Cadre marketing 35 ans, follow Tim Ferriss + 20 newsletters, achète tôt les nouveautés' },
        ],
      },
      positioning: {
        unique_value: `${brandName} combine ${industry} avec personnalisation IA — unique sur le marché.`,
        differentiation: ['Made in Europe', 'Sur-mesure abordable', 'Communauté co-création'],
        brand_promise: `Avec ${brandName}, ton produit te ressemble.`,
      },
      objectives: [
        { horizon: '30d', kpi: 'Followers Instagram', target: '+500', rationale: 'Construire la base initiale' },
        { horizon: '90d', kpi: 'Visites site', target: '5000/mois', rationale: 'Driver trafic qualifié' },
        { horizon: '12mo', kpi: 'Revenue', target: '+100%', rationale: 'Conversion long terme' },
      ],
      content_pillars: [
        { name: 'Éducation', description: 'Apprendre à l\'audience le métier', weight_pct: 40, examples: ['Carousel "5 erreurs à éviter"', 'Reel "behind the scenes"', 'Post "guide débutant"'] },
        { name: 'Inspiration', description: 'Cas client + résultats', weight_pct: 30, examples: ['Témoignage client', 'Avant/après', 'Use case'] },
        { name: 'Communauté', description: 'UGC + engagement', weight_pct: 20, examples: ['Sondage stories', 'Quiz', 'Q&A live'] },
        { name: 'Promotion', description: 'Offres et lancements', weight_pct: 10, examples: ['Lancement produit', 'Promo saisonnière', 'Codes parrainage'] },
      ],
      channels: [
        { platform: 'INSTAGRAM', role: 'Notoriété + community', frequency: '4 posts + 3 stories/sem', format_focus: ['Reels', 'Carrousels', 'Stories'] },
        { platform: 'LINKEDIN', role: 'B2B + thought leadership', frequency: '2-3 posts/sem', format_focus: ['Articles', 'Posts'] },
        { platform: 'TIKTOK', role: 'Découverte + viralité', frequency: '3 vidéos/sem', format_focus: ['Vidéo courte'] },
      ],
      campaigns: [
        { name: 'Lancement Été', period: 'Mois 1', objective: 'Awareness', channels: ['INSTAGRAM', 'TIKTOK'], key_message: 'Découvre notre nouvelle gamme' },
        { name: 'Black Friday', period: 'Mois 3', objective: 'Conversion', channels: ['INSTAGRAM', 'FACEBOOK', 'EMAIL'], key_message: '-30% 48h seulement' },
      ],
      experiments: ['Test format Reel vs Carrousel', 'A/B headline LinkedIn', 'UGC contest hashtag'],
      risks_mitigation: [
        { risk: 'Algorithme Instagram change', mitigation: 'Diversifier sur TikTok + LinkedIn' },
        { risk: 'Budget influence limité', mitigation: 'Privilégier micro-influenceurs <50k' },
      ],
      budget_split: { content_production: '50%', paid_media: '30%', tools: '10%', influencers: '10%' },
    },
    items: [
      { kind: 'CONTENT_PILLAR', title: 'Pilier Éducation', description: 'Définir 1 série hebdomadaire éducative récurrente' },
      { kind: 'POST_IDEA', title: 'Top 5 erreurs en ' + industry, description: 'Carrousel 5-7 slides listant les erreurs courantes avec mini-solution', platform: 'INSTAGRAM', format: 'INSTAGRAM_CAROUSEL', hashtags: ['#' + brandName.toLowerCase()], cta: 'Lis le guide complet →' },
      { kind: 'POST_IDEA', title: 'Notre histoire en 30s', description: 'Reel narratif: comment la marque est née, problème résolu, mission', platform: 'INSTAGRAM', format: 'INSTAGRAM_REEL', cta: 'Découvre notre univers' },
      { kind: 'REEL_IDEA', title: 'Behind the scenes atelier', description: 'Vidéo 30s montrant le processus de fabrication', platform: 'INSTAGRAM', format: 'INSTAGRAM_REEL' },
      { kind: 'CAMPAIGN_IDEA', title: 'Lancement nouvelle gamme', description: 'Campagne 2 semaines: teaser + reveal + UGC challenge' },
      { kind: 'AD_IDEA', title: 'Meta Ads carrousel produit', description: 'Audience: lookalike acheteurs design, budget €5/jour, format carrousel 5 produits' },
      { kind: 'EMAIL_IDEA', title: 'Welcome series 3 emails', description: 'Email 1: bienvenue + valeur. Email 2: backstory. Email 3: offre découverte -15%' },
      { kind: 'EXPERIMENT', title: 'A/B Reels vs Carrousels', description: 'Sur 2 semaines, publier équivalents, comparer reach + engagement' },
      { kind: 'PARTNERSHIP', title: 'Micro-influenceur design', description: 'Identifier 5 micro-influenceurs (10-30k followers) niche design urbain, proposer collab produit' },
      { kind: 'MILESTONE', title: 'Atteindre 1000 followers IG', description: 'Cible: 1000 followers Instagram dans les 30 jours' },
    ],
  };
}
