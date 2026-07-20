import { describe, it, expect, vi, beforeEach } from 'vitest';

// La DB et le routeur IA sont mockés : on teste la LOGIQUE d'orchestration
// (validation, garde-fous, honnêteté), pas les intégrations.
const agentRunCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'ar1', ...args.data }));
const agentRunUpdate = vi.fn(async () => ({}));
const automationCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'auto1', ...args.data }));

vi.mock('@/lib/db', () => ({
  db: {
    agentRun: { create: (a: never) => agentRunCreate(a), update: (a: never) => agentRunUpdate() },
    automation: { create: (a: never) => automationCreate(a), findMany: vi.fn(async () => []) },
    automationRun: { findFirst: vi.fn(async () => null), update: vi.fn(async () => ({})) },
  },
}));

const generateTextForTask = vi.fn();
vi.mock('@/services/ai/AIRouterService', () => ({
  AIRouterService: { generateTextForTask: (...a: unknown[]) => generateTextForTask(...a) },
}));

import { WorkflowOrchestratorService } from '@/services/agent/WorkflowOrchestratorService';

const basePlan = {
  name: 'Post LinkedIn hebdo',
  triggerType: 'FREQUENCY',
  triggerConfig: { cron: '0 9 * * 1' },
  steps: [
    { actionType: 'GENERATE_POST', config: { prompt: 'x' } },
    { actionType: 'PUBLISH_POST', config: {} },
  ],
  confidence: 0.8,
  risks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WorkflowOrchestratorService.planWorkflowFromPrompt', () => {
  it('crée un workflow DRAFT et injecte REQUEST_APPROVAL avant PUBLISH_POST', async () => {
    generateTextForTask.mockResolvedValue({ text: JSON.stringify(basePlan), mocked: false, provider: 'claude' });
    const r = await WorkflowOrchestratorService.planWorkflowFromPrompt({
      organizationId: 'org1',
      prompt: 'Publie un post LinkedIn chaque lundi',
    });
    expect(r.automationId).toBe('auto1');
    const created = automationCreate.mock.calls[0][0].data as {
      status: string;
      steps: { create: { actionType: string }[] };
    };
    // Jamais ACTIVE sans humain.
    expect(created.status).toBe('DRAFT');
    const actions = created.steps.create.map((s) => s.actionType);
    const publishIdx = actions.indexOf('PUBLISH_POST');
    expect(actions[publishIdx - 1]).toBe('REQUEST_APPROVAL');
  });

  it('rejette un plan avec un actionType hors liste blanche (pas de réparation silencieuse)', async () => {
    generateTextForTask.mockResolvedValue({
      text: JSON.stringify({ ...basePlan, steps: [{ actionType: 'DELETE_DATABASE', config: {} }] }),
      mocked: false,
      provider: 'claude',
    });
    const r = await WorkflowOrchestratorService.planWorkflowFromPrompt({
      organizationId: 'org1',
      prompt: 'fais un truc',
    });
    expect(r.automationId).toBeNull();
    expect(r.error).toContain('Plan rejeté');
    expect(automationCreate).not.toHaveBeenCalled();
  });

  it("en mode mock, ne fabrique PAS de faux plan intelligent", async () => {
    generateTextForTask.mockResolvedValue({ text: '[MOCK] blabla', mocked: true, provider: 'mock' });
    const r = await WorkflowOrchestratorService.planWorkflowFromPrompt({
      organizationId: 'org1',
      prompt: 'Publie un post chaque lundi',
    });
    expect(r.automationId).toBeNull();
    expect(r.mocked).toBe(true);
    expect(r.error).toContain('mode simulation');
  });

  it('journalise chaque invocation dans AgentRun (la DB est la mémoire, pas Claude)', async () => {
    generateTextForTask.mockResolvedValue({ text: JSON.stringify(basePlan), mocked: false, provider: 'claude' });
    await WorkflowOrchestratorService.planWorkflowFromPrompt({ organizationId: 'org1', prompt: 'x'.repeat(20) });
    expect(agentRunCreate).toHaveBeenCalledTimes(1);
    expect(agentRunUpdate).toHaveBeenCalledTimes(1);
  });
});
