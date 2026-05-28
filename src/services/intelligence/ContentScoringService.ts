/**
 * ContentScoringService — pre-publish quality scoring on 6 dimensions.
 *
 * Mission: prevent bad posts from going live, surface concrete improvements,
 *          learn what works for each brand over time.
 *
 * Output:
 *   - overall score (0-100)
 *   - 6 sub-scores (brandConsistency, hookQuality, ctaClarity,
 *                   hashtagRelevance, formatFit, viralityPotential)
 *   - rationale + actionable suggestions per dimension
 *   - mocked flag if AI unavailable
 */
import { AIRouterService } from '@/services/ai/AIRouterService';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { BrandContext } from '@/services/ai/types';

export interface ScoringDimension {
  score: number; // 0-100
  rationale: string;
  suggestions: string[];
}

export interface ContentScore {
  overall: number;
  verdict: 'EXCELLENT' | 'GOOD' | 'NEEDS_WORK' | 'POOR';
  dimensions: {
    brandConsistency: ScoringDimension;
    hookQuality: ScoringDimension;
    ctaClarity: ScoringDimension;
    hashtagRelevance: ScoringDimension;
    formatFit: ScoringDimension;
    viralityPotential: ScoringDimension;
  };
  topSuggestions: string[];
  riskFlags: string[];
  mocked: boolean;
}

export interface ScoringInput {
  body: string;
  hashtags?: string[];
  cta?: string | null;
  platform?: string;
  format?: string;
  language?: string;
  brandId?: string | null;
}

function verdictFrom(score: number): ContentScore['verdict'] {
  if (score >= 85) return 'EXCELLENT';
  if (score >= 70) return 'GOOD';
  if (score >= 50) return 'NEEDS_WORK';
  return 'POOR';
}

function mockScore(input: ScoringInput): ContentScore {
  const len = input.body.length;
  const hasCta = !!input.cta;
  const hashtagCount = input.hashtags?.length ?? 0;
  const has = (re: RegExp) => re.test(input.body);
  const hookScore = has(/^(.{0,80}\?|[A-ZÉÈÀ]{3,})/) ? 75 : 55;
  const fmtScore = len > 50 && len < 2200 ? 80 : 45;
  const ctaScore = hasCta ? 78 : 40;
  const tagScore = hashtagCount >= 3 && hashtagCount <= 12 ? 75 : 50;
  const brandScore = 68;
  const viralScore = (hookScore + tagScore + fmtScore) / 3;
  const overall = Math.round((hookScore + fmtScore + ctaScore + tagScore + brandScore + viralScore) / 6);
  return {
    overall,
    verdict: verdictFrom(overall),
    dimensions: {
      brandConsistency: { score: brandScore, rationale: '[mock] Ton et vocabulaire approximativement alignés.', suggestions: ['Charger la marque pour un audit précis.'] },
      hookQuality: { score: hookScore, rationale: '[mock] Hook moyen — pas d\'accroche forte détectée.', suggestions: ['Commence par une question ou un chiffre choc.'] },
      ctaClarity: { score: ctaScore, rationale: hasCta ? '[mock] CTA présent.' : '[mock] CTA manquant.', suggestions: hasCta ? [] : ['Ajoute un CTA explicite (action + bénéfice).'] },
      hashtagRelevance: { score: tagScore, rationale: `[mock] ${hashtagCount} hashtags.`, suggestions: hashtagCount < 3 ? ['Ajoute 3-8 hashtags niche.'] : [] },
      formatFit: { score: fmtScore, rationale: `[mock] Longueur ${len} chars.`, suggestions: len > 2200 ? ['Trop long pour ce format.'] : [] },
      viralityPotential: { score: Math.round(viralScore), rationale: '[mock] Potentiel viral moyen.', suggestions: ['Ajoute un élément de surprise ou de contre-intuition.'] },
    },
    topSuggestions: [
      'Renforcer le hook en 5 premiers mots',
      hasCta ? 'CTA OK — vérifier qu\'il est mesurable' : 'Ajouter un CTA clair',
      'Tester 2 variantes A/B avant publication',
    ],
    riskFlags: [],
    mocked: true,
  };
}

async function loadBrandContext(brandId: string | null | undefined): Promise<BrandContext | undefined> {
  if (!brandId) return undefined;
  const brand = await db.brand.findUnique({
    where: { id: brandId },
    include: { profile: true },
  });
  if (!brand) return undefined;
  return {
    name: brand.name,
    slogan: brand.profile?.slogan,
    mission: brand.profile?.mission,
    values: brand.profile?.values ?? [],
    audienceTarget: brand.profile?.audienceTarget,
    toneOfVoice: brand.profile?.toneOfVoice,
    wordsToUse: brand.profile?.wordsToUse ?? [],
    wordsToAvoid: brand.profile?.wordsToAvoid ?? [],
    officialHashtags: brand.profile?.officialHashtags ?? [],
  };
}

function buildBrandSection(brand: BrandContext | undefined): string {
  if (!brand) return 'Aucune marque chargée — utilise des standards génériques de qualité.';
  return [
    `Marque: ${brand.name}`,
    brand.slogan ? `Slogan: ${brand.slogan}` : '',
    brand.toneOfVoice ? `Ton: ${brand.toneOfVoice}` : '',
    brand.audienceTarget ? `Cible: ${brand.audienceTarget}` : '',
    brand.values?.length ? `Valeurs: ${brand.values.join(', ')}` : '',
    brand.wordsToUse?.length ? `Mots à utiliser: ${brand.wordsToUse.join(', ')}` : '',
    brand.wordsToAvoid?.length ? `Mots à éviter: ${brand.wordsToAvoid.join(', ')}` : '',
    brand.officialHashtags?.length ? `Hashtags officiels: ${brand.officialHashtags.join(' ')}` : '',
  ].filter(Boolean).join('\n');
}

export const ContentScoringService = {
  async score(input: ScoringInput): Promise<ContentScore> {
    if (!input.body || input.body.length < 5) {
      return mockScore(input);
    }
    const brand = await loadBrandContext(input.brandId);
    const brandSection = buildBrandSection(brand);

    const systemPrompt = `Tu es un expert en social media marketing avec 10 ans d'expérience.
Tu évalues un post avant publication sur 6 dimensions, chacune notée /100.

Réponds STRICTEMENT en JSON valide, structure exacte:
{
  "dimensions": {
    "brandConsistency": { "score": 0-100, "rationale": "1 phrase précise", "suggestions": ["action concrète 1", "action 2"] },
    "hookQuality":      { "score": 0-100, "rationale": "...", "suggestions": [...] },
    "ctaClarity":       { "score": 0-100, "rationale": "...", "suggestions": [...] },
    "hashtagRelevance": { "score": 0-100, "rationale": "...", "suggestions": [...] },
    "formatFit":        { "score": 0-100, "rationale": "...", "suggestions": [...] },
    "viralityPotential":{ "score": 0-100, "rationale": "...", "suggestions": [...] }
  },
  "topSuggestions": ["top 3 améliorations par ordre d'impact"],
  "riskFlags": ["compliance/légal/ton — vide si rien"]
}

Critères:
- brandConsistency: alignement ton, vocabulaire, valeurs (utilise mots à éviter/utiliser)
- hookQuality: 5 premiers mots, accroche, curiosité
- ctaClarity: action explicite, bénéfice, friction
- hashtagRelevance: nombre adapté au format, mix niche/large, hashtags marque
- formatFit: longueur, structure, conventions plateforme
- viralityPotential: shareability, controverse positive, émotion, twist

Sois sévère mais juste. Un score de 85+ est rare. 60-70 = moyenne. <50 = à refaire.`;

    const userPrompt = `Évalue ce post pour publication.

=== MARQUE ===
${brandSection}

=== POST ===
Plateforme: ${input.platform ?? 'N/A'}
Format: ${input.format ?? 'N/A'}
Langue: ${input.language ?? 'fr'}

Corps:
${input.body}

Hashtags: ${input.hashtags?.join(' ') ?? '(aucun)'}
CTA: ${input.cta ?? '(aucun)'}

Rends le JSON.`;

    try {
      const result = await AIRouterService.generateTextForTask('TEXT_STRUCTURED_JSON', {
        prompt: userPrompt,
        systemPrompt,
        maxTokens: 2000,
        temperature: 0.3,
      });
      const match = result.text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      const parsed = JSON.parse(match[0]) as Omit<ContentScore, 'overall' | 'verdict' | 'mocked'>;
      const dims = parsed.dimensions;
      const scores = [
        dims.brandConsistency.score, dims.hookQuality.score, dims.ctaClarity.score,
        dims.hashtagRelevance.score, dims.formatFit.score, dims.viralityPotential.score,
      ];
      const overall = Math.round(scores.reduce((s, x) => s + x, 0) / scores.length);
      return {
        overall,
        verdict: verdictFrom(overall),
        dimensions: dims,
        topSuggestions: parsed.topSuggestions ?? [],
        riskFlags: parsed.riskFlags ?? [],
        mocked: result.mocked,
      };
    } catch (err) {
      logger.warn('Content scoring failed, fallback to heuristic', { err: (err as Error).message });
      return mockScore(input);
    }
  },

  /**
   * Persist a score on the post metadata for analytics + self-improvement loop.
   */
  async logScore(opts: { postId: string; score: ContentScore }) {
    try {
      const post = await db.post.findUnique({ where: { id: opts.postId }, select: { metadata: true } });
      const meta = (post?.metadata as Record<string, unknown> | null) ?? {};
      const history = Array.isArray(meta.scoreHistory) ? meta.scoreHistory as unknown[] : [];
      history.push({ at: new Date().toISOString(), overall: opts.score.overall, verdict: opts.score.verdict, mocked: opts.score.mocked });
      await db.post.update({
        where: { id: opts.postId },
        data: {
          metadata: {
            ...meta,
            lastScore: {
              overall: opts.score.overall,
              verdict: opts.score.verdict,
              dimensions: Object.fromEntries(Object.entries(opts.score.dimensions).map(([k, v]) => [k, v.score])),
              at: new Date().toISOString(),
            },
            scoreHistory: history.slice(-10), // keep last 10
          } as never,
        },
      });
    } catch (err) {
      logger.warn('logScore failed', { err: (err as Error).message });
    }
  },
};
