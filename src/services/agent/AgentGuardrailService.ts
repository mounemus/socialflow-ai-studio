/**
 * AgentGuardrailService — budgets et limites de l'agent par organisation.
 *
 * Règles :
 *   - budget mensuel (AgentPolicy.monthlyCostCentsLimit, défaut 2000 cents = 20 $,
 *     surchargé par AGENT_DEFAULT_BUDGET_CENTS) calculé sur les coûts RÉELS
 *     journalisés (AIRequest.costCents + AgentRun.costCents, mois calendaire) ;
 *   - dépassement → l'agent REFUSE d'invoquer un modèle, avec un message
 *     explicite, et la décision est journalisée dans AgentRun ;
 *   - AgentPolicy.enabled=false → agent coupé pour l'organisation.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface BudgetCheck {
  allowed: boolean;
  reason?: string;
  spentCents: number;
  limitCents: number;
  enabled: boolean;
}

function monthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export const AgentGuardrailService = {
  defaultLimitCents(): number {
    const env = Number(process.env.AGENT_DEFAULT_BUDGET_CENTS);
    return Number.isFinite(env) && env >= 0 ? env : 2000;
  },

  async checkBudget(organizationId: string): Promise<BudgetCheck> {
    const policy = await db.agentPolicy
      .findUnique({ where: { organizationId } })
      .catch(() => null); // table absente avant migration → politique par défaut
    const limitCents = policy?.monthlyCostCentsLimit ?? this.defaultLimitCents();
    const enabled = policy?.enabled ?? true;

    if (!enabled) {
      return {
        allowed: false,
        reason: 'Agent désactivé pour cette organisation (AgentPolicy.enabled=false).',
        spentCents: 0,
        limitCents,
        enabled,
      };
    }

    if (limitCents === 0) {
      return {
        allowed: false,
        reason: 'Budget IA mensuel fixé à 0 — agent coupé pour cette organisation.',
        spentCents: 0,
        limitCents,
        enabled,
      };
    }

    const since = monthStart();
    const [ai, agent] = await Promise.all([
      db.aIRequest.aggregate({
        where: { organizationId, createdAt: { gte: since } },
        _sum: { costCents: true },
      }),
      db.agentRun.aggregate({
        where: { organizationId, createdAt: { gte: since } },
        _sum: { costCents: true },
      }),
    ]);
    const spentCents = (ai._sum.costCents ?? 0) + (agent._sum.costCents ?? 0);

    if (spentCents >= limitCents) {
      return {
        allowed: false,
        reason: `Budget IA mensuel atteint (${(spentCents / 100).toFixed(2)}$ / ${(limitCents / 100).toFixed(2)}$). Augmentez la limite dans la politique de l'agent.`,
        spentCents,
        limitCents,
        enabled,
      };
    }
    return { allowed: true, spentCents, limitCents, enabled };
  },

  /** Journalise un refus budgétaire (le journal des décisions vit en DB). */
  async logRefusal(organizationId: string, context: string, check: BudgetCheck): Promise<void> {
    logger.warn('Agent bloqué par garde-fou budgétaire', { organizationId, context, ...check });
    await db.agentRun
      .create({
        data: {
          organizationId,
          kind: 'OPERATOR',
          status: 'CANCELLED',
          title: `Refus garde-fou — ${context}`,
          input: { context } as never,
          output: { refused: true, reason: check.reason, spentCents: check.spentCents, limitCents: check.limitCents } as never,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
  },
};
