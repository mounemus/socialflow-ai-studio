/**
 * Veille intelligente — moteur commun aux modules Veille et Concurrents :
 *
 *   1. acquiert le contexte du profil de la marque active,
 *   2. recherche et observe le web en temps réel (Gemini + Google Search,
 *      gratuit — même moteur que la Prospection),
 *   3. produit un rapport structuré persistant (WatchReport) avec sources.
 *
 * Kinds : MARKET (marché & tendances), COMPETITION (paysage concurrentiel),
 * PRICING (veille prix), COMPETITOR (analyse profonde d'un concurrent).
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { GeminiService } from '@/services/ai/GeminiService';
import { extractJson } from '@/services/strategy/MarketingStrategyService';
import { getActiveBrandId } from '@/lib/tenant';

export type WatchKind = 'MARKET' | 'COMPETITION' | 'PRICING';

export type WatchReportContent = {
  title?: string;
  summary?: string;
  findings?: Array<{ title?: string; detail?: string; sourceUrl?: string }>;
  opportunities?: string[];
  risks?: string[];
  recommendations?: string[];
  competitors?: Array<{ name?: string; website?: string; positioning?: string }>;
  prices?: Array<{ offer?: string; provider?: string; price?: string; note?: string }>;
  // Analyse profonde d'un concurrent
  positioning?: string;
  marketing?: string[];
  pricing?: Array<{ offer?: string; price?: string; note?: string }>;
  messaging?: string[];
  publications?: string[];
  strengths?: string[];
  weaknesses?: string[];
};

type RunResult =
  | { ok: false; reason: string }
  | { ok: true; reportId: string; content: WatchReportContent; sources: Array<{ uri: string; title: string }> };

/** Contexte de marque injecté dans chaque analyse. */
async function brandContext(organizationId: string): Promise<{ brandId: string | null; block: string; name: string }> {
  const brandId = await getActiveBrandId(organizationId);
  const brand = brandId
    ? await db.brand.findFirst({ where: { id: brandId }, include: { profile: true } })
    : null;
  if (!brand) return { brandId: null, block: 'Aucune marque active — analyse générique.', name: 'la marque' };
  const p = brand.profile;
  const block = [
    `Marque : ${brand.name}`,
    brand.description ? `Description : ${brand.description}` : null,
    p?.mission ? `Mission : ${p.mission}` : null,
    p?.audienceTarget ? `Audience cible : ${p.audienceTarget}` : null,
    p?.slogan ? `Slogan : ${p.slogan}` : null,
    brand.industry ? `Industrie : ${brand.industry}` : null,
  ].filter(Boolean).join('\n');
  return { brandId, block, name: brand.name };
}

// Deux temps : (1) recherche web → rapport texte détaillé (le mode recherche de
// Gemini produit de la prose fiable, pas du JSON) ; (2) structuration du texte
// en JSON forcé (responseMimeType — fiable) sans outil de recherche.
function kindSpec(kind: WatchKind, brandName: string): { title: string; research: string; schema: string } {
  switch (kind) {
    case 'MARKET':
      return {
        title: `Veille marché & tendances — ${brandName}`,
        research:
          `Tu es analyste de marché senior. Réalise une VEILLE MARCHÉ & TENDANCES à jour (recherche web récente) pour cette marque : ` +
          `tendances actuelles du secteur, évolutions de la demande, nouveautés, signaux faibles pertinents. ` +
          `Rapport détaillé et FACTUEL : dates, chiffres et noms réels quand disponibles. Ne rien inventer.`,
        schema:
          `{"title": string, "summary": string, "findings": [{"title": string, "detail": string, "sourceUrl": string|null}], ` +
          `"opportunities": [string], "risks": [string], "recommendations": [string]}`,
      };
    case 'COMPETITION':
      return {
        title: `Veille concurrentielle — ${brandName}`,
        research:
          `Tu es analyste concurrentiel senior. Réalise une VEILLE CONCURRENTIELLE à jour (recherche web) pour cette marque : ` +
          `identifie les concurrents RÉELS (directs et indirects, locaux et en ligne) avec leur site web, leur positionnement ` +
          `et ce qu'ils font en marketing. Rapport détaillé et factuel. Ne rien inventer.`,
        schema:
          `{"title": string, "summary": string, "competitors": [{"name": string, "website": string|null, "positioning": string}], ` +
          `"findings": [{"title": string, "detail": string, "sourceUrl": string|null}], "opportunities": [string], "risks": [string], "recommendations": [string]}`,
      };
    case 'PRICING':
      return {
        title: `Veille prix — ${brandName}`,
        research:
          `Tu es analyste pricing senior. Réalise une VEILLE PRIX à jour (recherche web) pour cette marque : ` +
          `prix publics pratiqués sur le marché pour des offres comparables (avec fournisseur et montant exacts), ` +
          `modèles de tarification, positionnement prix recommandé. Rapport détaillé et factuel. Ne rien inventer.`,
        schema:
          `{"title": string, "summary": string, "prices": [{"offer": string, "provider": string, "price": string, "note": string|null}], ` +
          `"opportunities": [string], "recommendations": [string]}`,
      };
  }
}

/** Étape 2 — structure un rapport texte en JSON (sans recherche, JSON forcé). */
async function structureReport(raw: string, schema: string): Promise<WatchReportContent | null> {
  const { text } = await GeminiService.generateText({
    prompt: `Rapport brut à structurer :\n\n${raw}`,
    systemInstruction:
      `Structure fidèlement le rapport fourni, sans rien inventer ni ajouter (champ inconnu = null ou tableau vide), en français. ` +
      `Réponds UNIQUEMENT en JSON strict suivant ce schéma : ${schema}`,
    temperature: 0.2,
    maxTokens: 4096,
    json: true,
  });
  return extractJson<WatchReportContent>(text);
}

export const IntelligentWatchService = {
  isConfigured(): boolean {
    return GeminiService.isConfigured();
  },

  /** Lance une veille (marché / concurrence / prix) et persiste le rapport. */
  async runWatch(organizationId: string, kind: WatchKind): Promise<RunResult> {
    if (!this.isConfigured()) return { ok: false, reason: 'Clé GOOGLE_GEMINI_API_KEY absente.' };
    const ctx = await brandContext(organizationId);
    const { title, research, schema } = kindSpec(kind, ctx.name);
    try {
      const grounded = await GeminiService.groundedResearch({
        query: `${research}\n\nContexte de la marque :\n${ctx.block}`,
        maxResults: 10,
        maxTokens: 4096,
      });
      if (!grounded.text.trim()) {
        return { ok: false, reason: 'La recherche web n’a rien renvoyé — réessaie dans un instant.' };
      }
      const content = await structureReport(grounded.text, schema);
      if (!content?.summary && !content?.findings?.length && !content?.prices?.length && !content?.competitors?.length) {
        logger.warn('IntelligentWatchService: rapport vide', { kind, text: grounded.text.slice(0, 300) });
        return { ok: false, reason: 'La recherche n’a rien produit d’exploitable — réessaie dans un instant.' };
      }
      const report = await db.watchReport.create({
        data: {
          organizationId,
          brandId: ctx.brandId,
          kind,
          title: content.title?.trim() || title,
          content: content as never,
          sources: grounded.sources as never,
        },
      });
      return { ok: true, reportId: report.id, content, sources: grounded.sources };
    } catch (err) {
      logger.warn('IntelligentWatchService.runWatch échec', { kind, error: (err as Error).message });
      return { ok: false, reason: (err as Error).message.slice(0, 200) };
    }
  },

  /** Analyse profonde d'UN concurrent : stratégie marketing, prix, messages, publications. */
  async analyzeCompetitor(organizationId: string, competitorId: string): Promise<RunResult> {
    if (!this.isConfigured()) return { ok: false, reason: 'Clé GOOGLE_GEMINI_API_KEY absente.' };
    const comp = await db.competitor.findFirst({ where: { id: competitorId, organizationId } });
    if (!comp) return { ok: false, reason: 'Concurrent introuvable.' };
    const ctx = await brandContext(organizationId);
    try {
      const grounded = await GeminiService.groundedResearch({
        query:
          `Tu es analyste concurrentiel senior. Analyse EN PROFONDEUR (recherche web à jour) la stratégie du concurrent « ${comp.name} »` +
          `${comp.website ? ` (site : ${comp.website})` : ''} : positionnement, actions marketing observables, offres et PRIX publics, ` +
          `messages clés / arguments de vente, canaux de publication (site, blog, réseaux sociaux) et cadence observable, forces, faiblesses, ` +
          `puis recommandations concrètes pour que « ${ctx.name} » se différencie. Rapport détaillé et factuel — ne rien inventer.` +
          `\n\nContexte de NOTRE marque :\n${ctx.block}`,
        maxResults: 10,
        maxTokens: 4096,
      });
      const content = await structureReport(
        grounded.text,
        `{"title": string, "summary": string, "positioning": string, "marketing": [string], ` +
          `"pricing": [{"offer": string, "price": string, "note": string|null}], "messaging": [string], "publications": [string], ` +
          `"strengths": [string], "weaknesses": [string], "recommendations": [string]}`,
      );
      if (!content?.summary && !content?.positioning) {
        return { ok: false, reason: 'Analyse sans résultat exploitable — vérifie le site du concurrent.' };
      }
      const report = await db.watchReport.create({
        data: {
          organizationId,
          brandId: ctx.brandId,
          competitorId: comp.id,
          kind: 'COMPETITOR',
          title: content.title?.trim() || `Analyse — ${comp.name}`,
          content: content as never,
          sources: grounded.sources as never,
        },
      });
      return { ok: true, reportId: report.id, content, sources: grounded.sources };
    } catch (err) {
      logger.warn('IntelligentWatchService.analyzeCompetitor échec', { competitorId, error: (err as Error).message });
      return { ok: false, reason: (err as Error).message.slice(0, 200) };
    }
  },

  /** Ajoute un concurrent depuis un simple lien : l'IA identifie l'entreprise. */
  async addCompetitorFromUrl(
    organizationId: string,
    url: string,
  ): Promise<{ ok: false; reason: string } | { ok: true; competitorId: string; name: string }> {
    if (!this.isConfigured()) return { ok: false, reason: 'Clé GOOGLE_GEMINI_API_KEY absente.' };
    const brandId = await getActiveBrandId(organizationId);
    try {
      const grounded = await GeminiService.groundedResearch({
        query:
          `Identifie l'entreprise derrière ce site : ${url}. Ne rien inventer — champ inconnu = null. ` +
          `Réponds UNIQUEMENT en JSON strict : {"name": string, "industry": string|null, "country": string|null, "keywords": [string]}`,
        maxResults: 5,
      });
      const parsed = extractJson<{ name?: string; industry?: string | null; country?: string | null; keywords?: string[] }>(grounded.text);
      const name = parsed?.name?.trim();
      if (!name) return { ok: false, reason: 'Impossible d’identifier l’entreprise depuis ce lien.' };
      const website = /^https?:\/\//.test(url) ? url : `https://${url}`;
      const existing = await db.competitor.findFirst({
        where: { organizationId, OR: [{ website }, { name: { equals: name, mode: 'insensitive' } }] },
      });
      if (existing) return { ok: true, competitorId: existing.id, name: existing.name };
      const comp = await db.competitor.create({
        data: {
          organizationId,
          brandId,
          name,
          website,
          industry: parsed?.industry ?? null,
          country: parsed?.country ?? null,
          keywords: (parsed?.keywords ?? []).slice(0, 8),
        },
      });
      return { ok: true, competitorId: comp.id, name: comp.name };
    } catch (err) {
      return { ok: false, reason: (err as Error).message.slice(0, 200) };
    }
  },
};
