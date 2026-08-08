import { describe, it, expect } from 'vitest';
import {
  createPipelineInput,
  approveStepInput,
  publishPostInput,
  schedulePostInput,
} from '@/lib/contracts';

/**
 * Tests de contrat client ↔ serveur.
 *
 * Chaque bloc encode le payload EXACT envoyé par un composant client et vérifie
 * qu'il est accepté par le schéma partagé (le même que la route API `parse`).
 * Les cas « régression » verrouillent les incidents du 2026-07-24 : à l'époque
 * le client et le serveur avaient divergé sur le nom d'une clé, cassant tout un
 * flux avec un « Invalid input » opaque.
 */

describe('createPipelineInput (POST /api/pipelines)', () => {
  it('accepte le payload de pipelines/new/page.tsx', () => {
    const res = createPipelineInput.safeParse({
      brandSeed: { name: 'Acme', industry: 'SaaS', description: 'desc' },
      horizon: '90d',
      language: 'fr',
      brandId: 'brand_123',
    });
    expect(res.success).toBe(true);
  });

  it('applique les valeurs par défaut', () => {
    const parsed = createPipelineInput.parse({ brandSeed: { name: 'Acme' } });
    expect(parsed.horizon).toBe('90d');
    expect(parsed.language).toBe('fr');
    expect(parsed.autoMode).toBe(false);
  });

  // Régression : l'ancien client envoyait `seed` au lieu de `brandSeed` → 422.
  it('rejette l’ancienne clé buguée `seed`', () => {
    const res = createPipelineInput.safeParse({ seed: { name: 'Acme' }, horizon: '90d' });
    expect(res.success).toBe(false);
  });

  it('exige un nom de marque non vide', () => {
    expect(createPipelineInput.safeParse({ brandSeed: { name: '' } }).success).toBe(false);
  });
});

describe('approveStepInput (POST /api/pipelines/[id]/approve)', () => {
  it('accepte les payloads des Actes 2 et 3', () => {
    expect(approveStepInput.safeParse({ stepName: 'VALIDATE_PROFILE' }).success).toBe(true);
    expect(approveStepInput.safeParse({ stepName: 'VALIDATE_STRATEGY_ITEMS' }).success).toBe(true);
  });

  it('rejette une étape inconnue', () => {
    expect(approveStepInput.safeParse({ stepName: 'NOPE' }).success).toBe(false);
  });
});

describe('publishPostInput (POST /api/posts/[id]/publish)', () => {
  // Régression : la route exigeait `socialAccountId`, l'Acte 5 envoie `platform`
  // → « Publication échouée: Invalid input ». Doit désormais être accepté.
  it('accepte { platform } seul (Acte 5)', () => {
    expect(publishPostInput.safeParse({ platform: 'INSTAGRAM' }).success).toBe(true);
  });

  it('accepte { socialAccountId } seul (Studio → Diffusion)', () => {
    expect(publishPostInput.safeParse({ socialAccountId: 'acc_1' }).success).toBe(true);
  });
});

describe('schedulePostInput (POST /api/posts/[id]/schedule)', () => {
  it('accepte { scheduledFor, platform } (Acte 5)', () => {
    const res = schedulePostInput.safeParse({
      scheduledFor: new Date().toISOString(),
      platform: 'LINKEDIN',
    });
    expect(res.success).toBe(true);
  });

  it('accepte `scheduledAt` comme alias', () => {
    expect(
      schedulePostInput.safeParse({ scheduledAt: new Date().toISOString(), platform: 'FACEBOOK' })
        .success,
    ).toBe(true);
  });

  it('exige une date de programmation', () => {
    expect(schedulePostInput.safeParse({ platform: 'LINKEDIN' }).success).toBe(false);
  });
});
