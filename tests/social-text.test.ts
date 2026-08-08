import { describe, it, expect } from 'vitest';
import { sanitizeSocialText } from '@/lib/social-text';

/**
 * Régression du 2026-07-28 : un post publié sur LinkedIn contenait littéralement
 * « # POST LINKEDIN — UbSkilled JobHunter », des séparateurs `---` et des
 * `**gras**`. Les réseaux ne rendent pas le markdown.
 */
describe('sanitizeSocialText', () => {
  it('retire l’en-tête technique « # POST LINKEDIN — Marque »', () => {
    const out = sanitizeSocialText('# POST LINKEDIN — UbSkilled JobHunter\n\nVotre CV compte.');
    expect(out).toBe('Votre CV compte.');
  });

  it('retire l’en-tête sans dièse préfixé d’un emoji (cas Facebook publié)', () => {
    const src = '🎯 Post Facebook — UbSkilled JobHunter\n\nVous méritez une stratégie qui vous ressemble.';
    expect(sanitizeSocialText(src)).toBe('Vous méritez une stratégie qui vous ressemble.');
  });

  it('préserve une vraie accroche qui ne nomme aucune plateforme', () => {
    const src = 'Publication du jour : nos résultats de septembre.\n\nLa suite en commentaire.';
    expect(sanitizeSocialText(src)).toBe(src);
  });

  it('retire les séparateurs horizontaux', () => {
    expect(sanitizeSocialText('Un\n\n---\n\nDeux')).toBe('Un\n\nDeux');
    expect(sanitizeSocialText('Un\n***\nDeux')).toBe('Un\n\nDeux');
  });

  it('retire le gras markdown en gardant le texte', () => {
    expect(sanitizeSocialText('**Votre CV** ne vous rend pas justice.')).toBe(
      'Votre CV ne vous rend pas justice.',
    );
    expect(sanitizeSocialText('__important__')).toBe('important');
  });

  it('convertit les puces markdown en puces typographiques', () => {
    expect(sanitizeSocialText('- un\n- deux')).toBe('• un\n• deux');
  });

  it('préserve émojis, hashtags et sauts de ligne utiles', () => {
    const src = 'Prêt ? 🎯\n\nDécouvrez la méthode.\n\n#emploi #carriere';
    expect(sanitizeSocialText(src)).toBe(src);
  });

  it('normalise les sauts de ligne excessifs et gère le vide', () => {
    expect(sanitizeSocialText('a\n\n\n\nb')).toBe('a\n\nb');
    expect(sanitizeSocialText('')).toBe('');
  });
});
