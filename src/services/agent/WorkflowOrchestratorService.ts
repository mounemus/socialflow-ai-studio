/**
 * WorkflowOrchestratorService — Claude comme orchestrateur INTELLIGENT,
 * jamais comme moteur transactionnel.
 *
 * Séparation stricte des responsabilités :
 *   - Claude : planifie un workflow depuis une phrase, choisit les étapes,
 *     recommande un fournisseur, explique un échec, propose un fallback,
 *     détecte les workflows inefficaces.
 *   - Prisma : SEULE mémoire du workflow (Automation/AutomationStep/
 *     AutomationRun/AgentRun). Aucun état ne vit dans le contexte du modèle.
 *   - BullMQ + AutomationEngine : SEUL exécuteur des étapes.
 *
 * Garde-fous :
 *   - Tout plan produit par Claude est validé par zod contre la liste blanche
 *     des triggers/actions — une sortie non conforme est rejetée, jamais "réparée" en aveugle.
 *   - Les workflows proposés sont créés en DRAFT : activation humaine obligatoire.
 *   - Toute étape PUBLISH_POST est précédée d'un REQUEST_APPROVAL injecté d'office.
 *   - Chaque invocation de l'orchestrateur est journalisée dans AgentRun
 *     (entrée, sortie, provider, mode réel/mock).
 */
import { z } from 'zod';
import type { AutomationActionType, AutomationTriggerType } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { AgentGuardrailService } from './AgentGuardrailService';

const TRIGGER_TYPES = [
  'DATE',
  'FREQUENCY',
  'NEW_TREND',
  'NEW_PRODUCT',
  'NEW_RSS_ITEM',
  'NEW_COMPETITOR_POST',
  'NEW_KEYWORD_HIT',
  'POST_FAILED',
  'POST_APPROVED',
  'HIGH_PERFORMANCE_POST',
] as const;

const ACTION_TYPES = [
  'GENERATE_POST',
  'GENERATE_IMAGE',
  'GENERATE_CANVA_BRIEF',
  'CREATE_DRAFT',
  'REQUEST_APPROVAL',
  'SCHEDULE_POST',
  'PUBLISH_POST',
  'TRANSLATE',
  'CREATE_AB_VARIANT',
  'SEND_NOTIFICATION',
  'CREATE_REPORT',
] as const;

const planSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(600).optional(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.unknown()).default({}),
  steps: z
    .array(
      z.object({
        actionType: z.enum(ACTION_TYPES),
        config: z.record(z.unknown()).default({}),
        rationale: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(10),
  confidence: z.number().min(0).max(1).default(0.5),
  risks: z.array(z.string().max(200)).default([]),
});

export type WorkflowPlan = z.infer<typeof planSchema>;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Aucun JSON dans la réponse du modèle');
  return JSON.parse(raw.slice(start, end + 1));
}

/** Toute publication automatisée passe par une validation humaine. */
function enforceApprovalBeforePublish(plan: WorkflowPlan): WorkflowPlan {
  const steps: WorkflowPlan['steps'] = [];
  for (const step of plan.steps) {
    if (
      step.actionType === 'PUBLISH_POST' &&
      steps[steps.length - 1]?.actionType !== 'REQUEST_APPROVAL'
    ) {
      steps.push({
        actionType: 'REQUEST_APPROVAL',
        config: {},
        rationale: 'Injecté automatiquement : aucune publication sans validation humaine.',
      });
    }
    steps.push(step);
  }
  return { ...plan, steps };
}

const PLANNER_SYSTEM_PROMPT = `Tu es l'orchestrateur de workflows de SocialFlow AI Studio.
À partir de la demande de l'utilisateur, tu produis UNIQUEMENT un objet JSON (aucun texte autour) décrivant un workflow.

Schéma exact :
{
  "name": string (3-120 chars, en français),
  "description": string (optionnel, ce que fait le workflow),
  "triggerType": un de ${JSON.stringify(TRIGGER_TYPES)},
  "triggerConfig": objet (ex: {"cron":"0 9 * * 1"} pour FREQUENCY, {"date":"ISO"} pour DATE),
  "steps": tableau ordonné (1-10) de {"actionType": un de ${JSON.stringify(ACTION_TYPES)}, "config": objet, "rationale": string courte},
  "confidence": nombre 0-1 (ta confiance dans ce plan),
  "risks": tableau de chaînes (risques ou informations manquantes)
}

Règles impératives :
- N'invente JAMAIS un actionType ou triggerType hors liste.
- Toute étape PUBLISH_POST doit être précédée de REQUEST_APPROVAL.
- Si la demande est ambiguë, choisis le plan le plus sûr et liste l'ambiguïté dans "risks".
- config de GENERATE_POST: {"prompt","platform","language"}; GENERATE_IMAGE: {"prompt"}; CREATE_DRAFT: {"format","body"}; SCHEDULE_POST: {"socialAccountId","scheduledFor"}; TRANSLATE: {"text","targetLanguage"}.`;

export const WorkflowOrchestratorService = {
  /**
   * Phrase → workflow DRAFT persisté. Claude propose, l'humain active.
   */
  async planWorkflowFromPrompt(args: {
    organizationId: string;
    userId?: string;
    brandId?: string | null;
    prompt: string;
  }): Promise<{
    automationId: string | null;
    plan: WorkflowPlan | null;
    mocked: boolean;
    provider: string;
    error?: string;
    agentRunId: string;
  }> {
    // Garde-fou budgétaire AVANT toute invocation de modèle.
    const budget = await AgentGuardrailService.checkBudget(args.organizationId);
    if (!budget.allowed) {
      await AgentGuardrailService.logRefusal(args.organizationId, 'planWorkflowFromPrompt', budget);
      return {
        automationId: null,
        plan: null,
        mocked: false,
        provider: 'none',
        error: budget.reason,
        agentRunId: '',
      };
    }

    const agentRun = await db.agentRun.create({
      data: {
        organizationId: args.organizationId,
        userId: args.userId,
        kind: 'OPERATOR',
        status: 'RUNNING',
        title: 'Plan de workflow depuis une phrase',
        input: { prompt: args.prompt, brandId: args.brandId ?? null } as never,
        startedAt: new Date(),
      },
    });

    const result = await AIRouterService.generateTextForTask('TEXT_STRUCTURED_JSON', {
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      prompt: args.prompt,
      language: 'fr',
      temperature: 0.2,
      maxTokens: 1500,
    });

    let plan: WorkflowPlan | null = null;
    let error: string | undefined;
    if (!result.mocked) {
      try {
        plan = enforceApprovalBeforePublish(planSchema.parse(extractJson(result.text)));
      } catch (err) {
        error = `Plan rejeté (validation): ${(err as Error).message}`;
        logger.warn('Workflow plan invalid — rejected, NOT repaired silently', {
          agentRunId: agentRun.id,
          err: (err as Error).message,
        });
      }
    } else {
      // Pas d'IA réelle disponible : on ne fabrique PAS un faux plan "intelligent".
      error = 'Aucun fournisseur IA réel disponible — planification impossible (mode simulation).';
    }

    let automationId: string | null = null;
    if (plan) {
      const automation = await db.automation.create({
        data: {
          organizationId: args.organizationId,
          brandId: args.brandId ?? undefined,
          name: plan.name,
          description: [
            plan.description ?? '',
            `— Proposé par l'agent (confiance ${(plan.confidence * 100).toFixed(0)}%).`,
            plan.risks.length ? `Risques: ${plan.risks.join(' · ')}` : '',
          ]
            .filter(Boolean)
            .join(' '),
          // DRAFT toujours : l'agent propose, seul un humain active.
          status: 'DRAFT',
          triggerType: plan.triggerType as AutomationTriggerType,
          triggerConfig: plan.triggerConfig as never,
          steps: {
            create: plan.steps.map((s, i) => ({
              order: i,
              actionType: s.actionType as AutomationActionType,
              config: { ...s.config, _rationale: s.rationale ?? null } as never,
            })),
          },
        },
      });
      automationId = automation.id;
    }

    await db.agentRun.update({
      where: { id: agentRun.id },
      data: {
        status: plan ? 'SUCCESS' : 'FAILED',
        finishedAt: new Date(),
        output: { plan, automationId, provider: result.provider, mocked: result.mocked, error } as never,
        errorMessage: error ?? null,
      },
    });

    return { automationId, plan, mocked: result.mocked, provider: result.provider, error, agentRunId: agentRun.id };
  },

  /**
   * Explique un échec d'exécution + recommande un fallback.
   * Les FAITS viennent de la DB (run, étapes, erreur) — Claude n'apporte que l'analyse.
   */
  async explainRunFailure(args: {
    organizationId: string;
    userId?: string;
    automationRunId: string;
  }): Promise<{ explanation: string; fallback: string | null; mocked: boolean; agentRunId: string }> {
    const run = await db.automationRun.findFirst({
      where: { id: args.automationRunId, automation: { organizationId: args.organizationId } },
      include: { automation: { include: { steps: { orderBy: { order: 'asc' } } } } },
    });
    if (!run) throw new Error('AutomationRun introuvable pour cette organisation');

    const facts = {
      workflow: run.automation.name,
      status: run.status,
      error: run.errorMessage,
      steps: run.automation.steps.map((s) => ({ order: s.order, action: s.actionType })),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };

    const agentRun = await db.agentRun.create({
      data: {
        organizationId: args.organizationId,
        userId: args.userId,
        kind: 'OPERATOR',
        status: 'RUNNING',
        title: `Explication d'échec — ${run.automation.name}`,
        input: { automationRunId: run.id, facts } as never,
        startedAt: new Date(),
      },
    });

    const result = await AIRouterService.generateTextForTask('TEXT_STRUCTURED_JSON', {
      systemPrompt:
        `Tu analyses l'échec d'un workflow marketing. Réponds UNIQUEMENT en JSON: ` +
        `{"explanation": string (français, clair, 2-4 phrases, sans jargon), ` +
        `"fallback": string|null (action corrective concrète: autre fournisseur, étape à modifier, reconnexion de compte...)}`,
      prompt: `Faits (source: base de données):\n${JSON.stringify(facts, null, 2)}`,
      language: 'fr',
      temperature: 0.2,
      maxTokens: 600,
    });

    let explanation = `Le workflow « ${run.automation.name} » a échoué : ${run.errorMessage ?? 'erreur inconnue'}.`;
    let fallback: string | null = null;
    if (!result.mocked) {
      try {
        const parsed = z
          .object({ explanation: z.string(), fallback: z.string().nullable() })
          .parse(extractJson(result.text));
        explanation = parsed.explanation;
        fallback = parsed.fallback;
      } catch {
        // L'explication déterministe ci-dessus reste valable.
      }
    }

    // La mémoire du diagnostic vit en DB, pas dans le contexte du modèle.
    await db.automationRun.update({
      where: { id: run.id },
      data: {
        output: {
          ...(run.output as Record<string, unknown>),
          agentDiagnosis: { explanation, fallback, at: new Date().toISOString(), mocked: result.mocked },
        } as never,
      },
    });
    await db.agentRun.update({
      where: { id: agentRun.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        output: { explanation, fallback, provider: result.provider, mocked: result.mocked } as never,
      },
    });

    return { explanation, fallback, mocked: result.mocked, agentRunId: agentRun.id };
  },

  /**
   * Audit d'efficacité : les métriques sont calculées en SQL (déterministe),
   * Claude ne fait que commenter et prioriser.
   */
  async auditWorkflows(args: { organizationId: string; userId?: string }): Promise<{
    findings: {
      automationId: string;
      name: string;
      status: string;
      runs: number;
      failures: number;
      failureRate: number;
      avgDurationMs: number | null;
      lastError: string | null;
      flags: string[];
    }[];
    recommendation: string | null;
    mocked: boolean;
  }> {
    const automations = await db.automation.findMany({
      where: { organizationId: args.organizationId },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });

    const findings = automations.map((a) => {
      const runs = a.runs.length;
      const failures = a.runs.filter((r) => r.status === 'FAILED').length;
      const durations = a.runs
        .filter((r) => r.startedAt && r.finishedAt)
        .map((r) => r.finishedAt!.getTime() - r.startedAt!.getTime());
      const avgDurationMs = durations.length
        ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
        : null;
      const failureRate = runs > 0 ? failures / runs : 0;
      const flags: string[] = [];
      if (runs >= 3 && failureRate > 0.3) flags.push('TAUX_ECHEC_ELEVE');
      if (avgDurationMs !== null && avgDurationMs > 60_000) flags.push('LENT');
      if (a.status === 'ACTIVE' && runs === 0) flags.push('ACTIF_JAMAIS_EXECUTE');
      if (a.status === 'DRAFT') flags.push('BROUILLON_EN_ATTENTE');
      return {
        automationId: a.id,
        name: a.name,
        status: a.status,
        runs,
        failures,
        failureRate: Math.round(failureRate * 100) / 100,
        avgDurationMs,
        lastError: a.runs.find((r) => r.errorMessage)?.errorMessage ?? null,
        flags,
      };
    });

    let recommendation: string | null = null;
    let mocked = true;
    const flagged = findings.filter((f) => f.flags.length > 0);
    if (flagged.length > 0) {
      const result = await AIRouterService.generateTextForTask('TEXT_LONGFORM', {
        systemPrompt:
          'Tu es un expert en automatisation marketing. En 3-6 phrases en français, priorise les corrections des workflows signalés (données ci-dessous). Sois concret et actionnable.',
        prompt: JSON.stringify(flagged, null, 2),
        language: 'fr',
        temperature: 0.3,
        maxTokens: 500,
      });
      mocked = result.mocked;
      recommendation = result.mocked ? null : result.text;
    }

    await db.agentRun.create({
      data: {
        organizationId: args.organizationId,
        userId: args.userId,
        kind: 'OPERATOR',
        status: 'SUCCESS',
        title: 'Audit des workflows',
        input: {} as never,
        output: { findings, recommendation, mocked } as never,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    return { findings, recommendation, mocked };
  },
};
