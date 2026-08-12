import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { GeminiService } from '@/services/ai/GeminiService';
import { extractJson } from '@/services/strategy/MarketingStrategyService';
import { learnedStrategyBlock } from '@/services/watch/learning';

const assistSchema = z.object({ mission: z.string().min(5).max(4000) });

const norm = (v?: string | null) => {
  const t = v?.trim();
  return t && t.toLowerCase() !== 'null' ? t : null;
};

export const maxDuration = 60;

type Assist = {
  query?: string;
  webQuery?: string;
  region?: string | null;
  titles?: string[];
  companyKeywords?: string[];
  seniorities?: string[];
  companySizes?: string[];
  rationale?: string;
};

/** POST /api/prospects/assist — l'IA transforme une mission/objectif en requête de prospection ciblée (Gemini, gratuit). */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { mission } = assistSchema.parse(await req.json());

  const SYSTEM = `Tu es un expert en prospection B2B. À partir de la mission de l'utilisateur, identifie QUI ACHÈTERAIT (les prospects cibles) — jamais ce que l'utilisateur vend.
Réponds UNIQUEMENT en JSON strict :
{
  "query": "le poste type de l'ACHETEUR, court, en ANGLAIS (ex: school principal, hr director) — jamais le nom du produit ou service vendu",
  "webQuery": "types d'ORGANISATIONS acheteuses, en FRANÇAIS, pour une recherche web (ex: écoles primaires et centres de services scolaires)",
  "region": "zone géographique si déductible de la mission, sinon null",
  "titles": ["1 à 4 intitulés de poste d'acheteurs en anglais, PRÉCIS — évite les titres fourre-tout (founder, ceo) sauf si la mission vise clairement les petites entreprises"],
  "companyKeywords": ["0 à 4 mots-clés en anglais du SECTEUR des entreprises acheteuses (ex: manufacturing, software) — tableau vide si tous secteurs"],
  "seniorities": ["parmi: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry"],
  "companySizes": ["parmi: 1,10 | 11,50 | 51,200 | 201,500 | 501,1000 | 1001,5000"],
  "rationale": "1 phrase en français expliquant qui viser et pourquoi"
}
Tableaux vides si non pertinent. N'invente jamais une zone absente de la mission.`;

  try {
    // Sortie JSON forcée (responseMimeType) ; flash d'abord, retente en pro si
    // la réponse est vide ou tronquée (budget de réflexion du flash).
    let parsed: Assist | null = null;
    for (const usePro of [false, true]) {
      const { text } = await GeminiService.generateText({
        prompt: `Mission / objectif commercial : « ${mission} »${await learnedStrategyBlock(ctx.organizationId)}`,
        systemInstruction: SYSTEM,
        temperature: 0.4,
        maxTokens: 2048,
        json: true,
        usePro,
      });
      parsed = extractJson<Assist>(text);
      if (parsed?.query) break;
      logger.warn('prospects/assist: réponse IA inexploitable', { usePro, text: text.slice(0, 300) });
    }
    if (!parsed?.query) {
      return ok({ error: 'L’IA n’a pas produit de requête exploitable — reformule la mission.' }, { status: 422 });
    }
    // Liste blanche — l'IA peut halluciner des valeurs hors référentiel qui
    // casseraient les selects de l'UI et les filtres Apollo.
    const VALID_SENIORITIES = new Set(['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director', 'manager', 'senior', 'entry']);
    const VALID_SIZES = new Set(['1,10', '11,50', '51,200', '201,500', '501,1000', '1001,5000']);
    const region = typeof parsed.region === 'string' && parsed.region.trim() && parsed.region.trim().toLowerCase() !== 'null'
      ? parsed.region.trim()
      : null;
    return ok({
      query: parsed.query,
      webQuery: norm(parsed.webQuery),
      region,
      titles: (parsed.titles ?? []).filter((t) => typeof t === 'string' && t.trim()).slice(0, 4),
      companyKeywords: (parsed.companyKeywords ?? []).filter((k) => typeof k === 'string' && k.trim()).slice(0, 4),
      seniorities: (parsed.seniorities ?? []).filter((s) => VALID_SENIORITIES.has(s)),
      companySizes: (parsed.companySizes ?? []).filter((s) => VALID_SIZES.has(s)),
      rationale: parsed.rationale ?? null,
    });
  } catch (err) {
    return ok({ error: `IA indisponible : ${(err as Error).message.slice(0, 120)}` }, { status: 422 });
  }
});
