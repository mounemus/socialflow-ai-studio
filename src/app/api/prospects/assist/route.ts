import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { GeminiService } from '@/services/ai/GeminiService';
import { extractJson } from '@/services/strategy/MarketingStrategyService';

const assistSchema = z.object({ mission: z.string().min(5).max(4000) });

export const maxDuration = 60;

type Assist = {
  query?: string;
  region?: string | null;
  titles?: string[];
  seniorities?: string[];
  companySizes?: string[];
  rationale?: string;
};

/** POST /api/prospects/assist — l'IA transforme une mission/objectif en requête de prospection ciblée (Gemini, gratuit). */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const { mission } = assistSchema.parse(await req.json());

  try {
    const { text } = await GeminiService.generateText({
      prompt: `Mission / objectif commercial : « ${mission} »`,
      systemInstruction:
        `Tu es un expert en prospection B2B. À partir de la mission de l'utilisateur, produis la requête de prospection optimale.
Réponds UNIQUEMENT en JSON strict :
{
  "query": "cible courte en ANGLAIS, optimisée pour les bases B2B type LinkedIn (ex: school principal)",
  "region": "zone géographique si déductible de la mission, sinon null",
  "titles": ["1 à 4 intitulés de poste en anglais"],
  "seniorities": ["parmi: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry"],
  "companySizes": ["parmi: 1,10 | 11,50 | 51,200 | 201,500 | 501,1000 | 1001,5000"],
  "rationale": "1 phrase en français expliquant qui viser et pourquoi"
}
Tableaux vides si non pertinent. N'invente jamais une zone absente de la mission.`,
      temperature: 0.4,
      // gemini-2.5-flash dépense une partie du budget en tokens de réflexion
      // interne — 512 coupait la réponse avant le JSON.
      maxTokens: 2048,
    });
    const parsed = extractJson<Assist>(text);
    if (!parsed?.query) {
      logger.warn('prospects/assist: réponse IA inexploitable', { text: text.slice(0, 300) });
      return ok({ error: 'L’IA n’a pas produit de requête exploitable — reformule la mission.' }, { status: 422 });
    }
    return ok({
      query: parsed.query,
      region: parsed.region ?? null,
      titles: parsed.titles ?? [],
      seniorities: parsed.seniorities ?? [],
      companySizes: parsed.companySizes ?? [],
      rationale: parsed.rationale ?? null,
    });
  } catch (err) {
    return ok({ error: `IA indisponible : ${(err as Error).message.slice(0, 120)}` }, { status: 422 });
  }
});
