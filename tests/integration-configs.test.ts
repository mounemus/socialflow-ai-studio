import { describe, it, expect } from 'vitest';
import { INTEGRATIONS, getIntegration, integrationsByCategory } from '@/lib/integration-configs';

describe('integration-configs', () => {
  it('all integrations have required fields', () => {
    for (const i of INTEGRATIONS) {
      expect(i.id).toBeTruthy();
      expect(i.label).toBeTruthy();
      expect(i.category).toBeTruthy();
      expect(i.docs).toMatch(/^https?:\/\//);
      expect(i.getKeysAt).toMatch(/^https?:\/\//);
      expect(i.envVars.length).toBeGreaterThan(0);
    }
  });

  it('OAuth integrations have an oauthStart path', () => {
    const oauthList = INTEGRATIONS.filter((i) => i.oauthStart);
    expect(oauthList.length).toBeGreaterThan(0);
    for (const i of oauthList) {
      expect(i.oauthStart).toMatch(/^\/api\//);
    }
  });

  it('canva is registered and has required env vars', () => {
    const canva = getIntegration('canva');
    expect(canva).toBeTruthy();
    const required = canva!.envVars.filter((v) => v.required).map((v) => v.key);
    expect(required).toContain('CANVA_CLIENT_ID');
    expect(required).toContain('CANVA_CLIENT_SECRET');
  });

  it('groups by category', () => {
    const map = integrationsByCategory();
    expect(Object.keys(map).length).toBeGreaterThan(3);
    expect(map.AI?.length ?? 0).toBeGreaterThan(0);
    expect(map.Social?.length ?? 0).toBeGreaterThan(0);
  });

  it('all unique ids', () => {
    const ids = INTEGRATIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
