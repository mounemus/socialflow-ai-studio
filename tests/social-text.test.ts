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

  /**
   * Régression du 2026-08-08 : la génération renvoyait un « kit » complet
   * (VISUEL SUGGÉRÉ / CAPTION / HASHTAGS / INFOS DE PUBLICATION) affiché tel
   * quel dans le Studio. Seule la CAPTION est la publication.
   */
  it('extrait la CAPTION d’une sortie « kit » et rattache les hashtags', () => {
    const src = [
      '🖼️ VISUEL SUGGÉRÉ',
      '*Mockup d’une boîte mail lumineuse — ambiance chaleureuse*',
      '',
      '✍️ CAPTION',
      '',
      'Tu reçois un email d’une marque… et tu l’ouvres vraiment. 📬',
      '',
      '3 emails. 4 jours. Une relation qui commence vraiment. 💡',
      '',
      '#️⃣ HASHTAGS',
      '',
      '#EmailMarketing #WelcomeSeries',
      '#UbSkilled',
      '',
      '📊 INFOS DE PUBLICATION',
      '',
      '| Élément | Recommandation |',
      '|---|---|',
      '| ⏰ Meilleur horaire | Mardi 9h |',
    ].join('\n');
    const out = sanitizeSocialText(src);
    expect(out).toContain('Tu reçois un email d’une marque');
    expect(out).toContain('#EmailMarketing #WelcomeSeries #UbSkilled');
    expect(out).not.toContain('VISUEL');
    expect(out).not.toContain('INFOS DE PUBLICATION');
    expect(out).not.toContain('|');
    expect(out).not.toContain('CAPTION');
  });

  it('supprime tableaux markdown et citations hors kit', () => {
    expect(sanitizeSocialText('Avant\n| a | b |\n> citation\nAprès')).toBe('Avant\ncitation\nAprès');
  });
});
