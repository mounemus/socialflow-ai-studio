/**
 * ProviderCapabilityRegistry — vue unifiée et honnête de chaque fournisseur IA :
 * disponibilité, modèles, tâches supportées, coût estimé, latence observée,
 * taux de réussite, qualité historique, mode réel ou simulé.
 *
 * Sources (aucune valeur inventée) :
 *   - disponibilité + tâches : AIRouterService (clés env + table de routage) ;
 *   - latence / taux de réussite / coût observé : AIReliabilityService (AIRequest en DB) ;
 *   - coût unitaire estimé : grilles tarifaires statiques (approximations documentées) ;
 *   - quota : non suivi à ce jour → null (on ne prétend pas le connaître).
 */
import { AIRouterService, type TaskType } from './AIRouterService';
import { AIReliabilityService } from './AIReliabilityService';

const MODELS: Record<string, string[]> = {
  claude: ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  gpt: [process.env.OPENAI_MODEL ?? 'gpt-4o-mini', 'gpt-5'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-image'],
  replicate: ['black-forest-labs/flux-schnell'],
  fal: ['fal-ai/flux/schnell', 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video'],
  stability: ['stable-diffusion-xl-1024-v1-0'],
  dalle: ['gpt-image-1'],
  canva: ['canva-connect'],
};

/** Coût estimé par requête typique (USD) — approximatif, affiché comme tel. */
const EST_COST_PER_CALL: Record<string, number> = {
  claude: 0.02,
  gpt: 0.001,
  gemini: 0.0005,
  replicate: 0.003,
  fal: 0.003,
  stability: 0.04,
  dalle: 0.04,
  canva: 0,
};

// Mapping provider AIRouter ↔ nom enregistré dans AIRequest.metadata.provider
const METRIC_KEYS: Record<string, string[]> = {
  claude: ['anthropic', 'claude'],
  gpt: ['openai', 'gpt'],
  gemini: ['gemini', 'gemini-grounded'],
  replicate: ['replicate'],
  fal: ['fal'],
  stability: ['stability'],
  dalle: ['dalle', 'openai-image'],
  canva: ['canva'],
};

export interface ProviderCapabilityEntry {
  id: string;
  label: string;
  available: boolean;
  mode: 'REAL' | 'SIMULATED' | 'UNAVAILABLE';
  models: string[];
  supportedTasks: TaskType[];
  estCostPerCallUsd: number | null;
  observed: {
    requests7d: number;
    successRate: number | null; // null = pas assez de données
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    estCostUsd7d: number | null;
  };
  /** Score qualité 0-100 (succès + latence), null sans historique. */
  reliabilityScore: number | null;
  quota: null; // non suivi — affiché comme inconnu, jamais inventé
}

export const ProviderCapabilityRegistry = {
  async getRegistry(organizationId?: string): Promise<{
    providers: ProviderCapabilityEntry[];
    routing: ReturnType<typeof AIRouterService.allPlans>;
    generatedAt: string;
  }> {
    const availability = AIRouterService.availability();
    const plans = AIRouterService.allPlans();
    const realAI = process.env.ENABLE_REAL_AI === 'true';

    // Métriques observées (7 jours) depuis AIRequest.
    const metrics = await AIReliabilityService.getMetrics(organizationId ?? null, 7).catch(() => []);
    const metricByProvider = new Map(metrics.map((m) => [m.provider, m]));

    const providers: ProviderCapabilityEntry[] = availability.map((p) => {
      const supportedTasks = plans
        .filter(
          (plan) =>
            plan.primary.provider === p.id || plan.fallbacks.some((f) => f.provider === p.id),
        )
        .map((plan) => plan.task);

      const keys = METRIC_KEYS[p.id] ?? [p.id];
      const observedList = keys.map((k) => metricByProvider.get(k)).filter(Boolean);
      const requests = observedList.reduce((s, m) => s + (m!.requests ?? 0), 0);
      const agg =
        requests > 0
          ? {
              requests7d: requests,
              successRate:
                observedList.reduce((s, m) => s + m!.successRate * m!.requests, 0) / requests,
              p50LatencyMs: Math.round(
                observedList.reduce((s, m) => s + m!.p50LatencyMs * m!.requests, 0) / requests,
              ),
              p95LatencyMs: Math.max(...observedList.map((m) => m!.p95LatencyMs)),
              estCostUsd7d: observedList.reduce((s, m) => s + (m!.estimatedCostUSD ?? 0), 0),
            }
          : { requests7d: 0, successRate: null, p50LatencyMs: null, p95LatencyMs: null, estCostUsd7d: null };

      const reliabilityScore =
        agg.successRate !== null && agg.p50LatencyMs !== null
          ? Math.round(
              Math.max(
                0,
                Math.min(100, agg.successRate * 80 + Math.max(0, 20 - agg.p50LatencyMs / 1000)),
              ),
            )
          : null;

      return {
        id: p.id,
        label: p.label,
        available: p.available,
        mode: !p.available ? 'UNAVAILABLE' : realAI || p.id === 'canva' ? 'REAL' : 'SIMULATED',
        models: p.available ? (MODELS[p.id] ?? []) : [],
        supportedTasks,
        estCostPerCallUsd: p.available ? (EST_COST_PER_CALL[p.id] ?? null) : null,
        observed: agg,
        reliabilityScore,
        quota: null,
      };
    });

    return { providers, routing: plans, generatedAt: new Date().toISOString() };
  },
};
