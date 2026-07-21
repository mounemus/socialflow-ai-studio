import { describe, it, expect, vi, beforeEach } from 'vitest';

const policyFind = vi.fn();
const aiAgg = vi.fn();
const runAgg = vi.fn();
const runCreate = vi.fn(async () => ({}));

vi.mock('@/lib/db', () => ({
  db: {
    agentPolicy: { findUnique: (...a: unknown[]) => policyFind(...a) },
    aIRequest: { aggregate: (...a: unknown[]) => aiAgg(...a) },
    agentRun: { aggregate: (...a: unknown[]) => runAgg(...a), create: (...a: unknown[]) => runCreate() },
  },
}));

import { AgentGuardrailService } from '@/services/agent/AgentGuardrailService';

beforeEach(() => {
  vi.clearAllMocks();
  policyFind.mockResolvedValue(null);
  aiAgg.mockResolvedValue({ _sum: { costCents: 0 } });
  runAgg.mockResolvedValue({ _sum: { costCents: 0 } });
});

describe('AgentGuardrailService.checkBudget', () => {
  it('autorise sous le budget par défaut', async () => {
    aiAgg.mockResolvedValue({ _sum: { costCents: 500 } });
    const r = await AgentGuardrailService.checkBudget('org1');
    expect(r.allowed).toBe(true);
    expect(r.spentCents).toBe(500);
    expect(r.limitCents).toBe(2000);
  });

  it('refuse quand le budget mensuel est atteint (coûts AIRequest + AgentRun cumulés)', async () => {
    aiAgg.mockResolvedValue({ _sum: { costCents: 1500 } });
    runAgg.mockResolvedValue({ _sum: { costCents: 600 } });
    const r = await AgentGuardrailService.checkBudget('org1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Budget IA mensuel atteint');
    expect(r.spentCents).toBe(2100);
  });

  it('respecte la limite personnalisée de la politique', async () => {
    policyFind.mockResolvedValue({ monthlyCostCentsLimit: 100, enabled: true });
    aiAgg.mockResolvedValue({ _sum: { costCents: 150 } });
    const r = await AgentGuardrailService.checkBudget('org1');
    expect(r.allowed).toBe(false);
    expect(r.limitCents).toBe(100);
  });

  it('refuse quand l’agent est désactivé, quel que soit le budget', async () => {
    policyFind.mockResolvedValue({ monthlyCostCentsLimit: 999999, enabled: false });
    const r = await AgentGuardrailService.checkBudget('org1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('désactivé');
  });

  it('limite 0 = agent coupé', async () => {
    policyFind.mockResolvedValue({ monthlyCostCentsLimit: 0, enabled: true });
    const r = await AgentGuardrailService.checkBudget('org1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('agent coupé');
  });

  it('journalise les refus dans AgentRun', async () => {
    policyFind.mockResolvedValue({ monthlyCostCentsLimit: 100, enabled: true });
    aiAgg.mockResolvedValue({ _sum: { costCents: 200 } });
    const r = await AgentGuardrailService.checkBudget('org1');
    await AgentGuardrailService.logRefusal('org1', 'test', r);
    expect(runCreate).toHaveBeenCalledTimes(1);
  });
});
