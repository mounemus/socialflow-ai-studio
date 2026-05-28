import { describe, it, expect } from 'vitest';
import { OperatorAgent } from '@/services/agent/OperatorAgent';

describe('OperatorAgent.computeNextRun', () => {
  it('hourly = next round hour', () => {
    const from = new Date('2026-01-01T10:30:00Z');
    const next = OperatorAgent.computeNextRun('hourly', from);
    expect(next.getUTCHours()).toBe(11);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it('every:6h = +6 hours', () => {
    const from = new Date('2026-01-01T10:00:00Z');
    const next = OperatorAgent.computeNextRun('every:6h', from);
    expect(next.getTime() - from.getTime()).toBe(6 * 3600 * 1000);
  });

  it('daily:09:00 picks today if later, tomorrow otherwise', () => {
    const morning = new Date('2026-01-01T07:00:00');
    const morningNext = OperatorAgent.computeNextRun('daily:09:00', morning);
    expect(morningNext.getDate()).toBe(1);

    const afternoon = new Date('2026-01-01T15:00:00');
    const afternoonNext = OperatorAgent.computeNextRun('daily:09:00', afternoon);
    expect(afternoonNext.getDate()).toBe(2);
  });

  it('weekly:mon:09:00 picks next Monday', () => {
    // 2026-01-01 is a Thursday
    const thursday = new Date('2026-01-01T07:00:00');
    const next = OperatorAgent.computeNextRun('weekly:mon:09:00', thursday);
    expect(next.getDay()).toBe(1); // Monday
    expect(next > thursday).toBe(true);
  });

  it('unknown expression defaults to +1 day', () => {
    const from = new Date('2026-01-01T10:00:00Z');
    const next = OperatorAgent.computeNextRun('not-a-real-cron', from);
    expect(next.getTime() - from.getTime()).toBe(86_400_000);
  });
});
