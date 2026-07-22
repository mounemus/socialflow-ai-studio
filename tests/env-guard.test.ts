import { describe, it, expect } from 'vitest';
import { apiBaseProblem } from '@/lib/env-guard';

describe('apiBaseProblem — garde-fou des bases d’API', () => {
  it('rejette une page Facebook comme base d’API (cas réel LATE_API_BASE)', () => {
    const p = apiBaseProblem('LATE_API_BASE', 'https://www.facebook.com/profile.php?id=61588241320131');
    expect(p).toBeTruthy();
    expect(p).toContain('facebook.com');
  });

  it('rejette les autres réseaux sociaux', () => {
    for (const host of ['instagram.com', 'www.linkedin.com', 'x.com', 'tiktok.com']) {
      expect(apiBaseProblem('FOO_API_BASE', `https://${host}/whatever`)).toBeTruthy();
    }
  });

  it('rejette http et les URL invalides', () => {
    expect(apiBaseProblem('LATE_API_BASE', 'http://zernio.com/api/v1')).toContain('https');
    expect(apiBaseProblem('LATE_API_BASE', 'pas-une-url')).toContain('pas une URL valide');
  });

  it('rejette notre propre URL de webhook comme base d’API (cas réel n°2)', () => {
    const p = apiBaseProblem('LATE_API_BASE', 'https://socialflow-ai-studio.vercel.app/api/webhooks/late');
    expect(p).toBeTruthy();
    expect(p).toContain('webhook');
  });

  it('rejette toute URL pointant vers SocialFlow lui-même', () => {
    expect(apiBaseProblem('LATE_API_BASE', 'https://socialflow-ai-studio.vercel.app/api/v1')).toBeTruthy();
  });

  it('accepte la base Zernio légitime et une valeur vide', () => {
    expect(apiBaseProblem('LATE_API_BASE', 'https://zernio.com/api/v1')).toBeNull();
    expect(apiBaseProblem('LATE_API_BASE', '')).toBeNull();
  });

  it('ignore les clés qui ne sont pas des bases d’API', () => {
    expect(apiBaseProblem('LATE_API_KEY', 'https://www.facebook.com/x')).toBeNull();
  });
});
