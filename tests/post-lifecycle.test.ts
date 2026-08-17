import { describe, expect, it } from 'vitest';
import { assertPublishable } from '@/lib/post-lifecycle';
import { postStatusMeta, PRODUCTION_COLUMNS } from '@/lib/post-status';

describe('post-lifecycle — porte de validation optionnelle', () => {
  it('sans exigence de validation, tout statut est publiable', () => {
    for (const status of ['DRAFT', 'AI_GENERATED', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHED']) {
      expect(() => assertPublishable({ status } as never, false)).not.toThrow();
    }
  });

  it('avec exigence de validation, seuls les posts validés ou déjà en aval passent', () => {
    expect(() => assertPublishable({ status: 'DRAFT' } as never, true)).toThrow(/validation/i);
    expect(() => assertPublishable({ status: 'PENDING_APPROVAL' } as never, true)).toThrow();
    expect(() => assertPublishable({ status: 'APPROVED' } as never, true)).not.toThrow();
    expect(() => assertPublishable({ status: 'SCHEDULED' } as never, true)).not.toThrow();
    expect(() => assertPublishable({ status: 'FAILED' } as never, true)).not.toThrow(); // republier
  });

  it('le vocabulaire des statuts est unique : APPROVED = « Prêt à publier » dans la colonne prêts', () => {
    expect(postStatusMeta('APPROVED').label).toBe('Prêt à publier');
    const col = PRODUCTION_COLUMNS.find((c) => c.id === 'approved');
    expect(col?.statuses).toContain('APPROVED');
    expect(PRODUCTION_COLUMNS.find((c) => c.id === 'review')?.statuses).toEqual(['PENDING_APPROVAL']);
  });
});
