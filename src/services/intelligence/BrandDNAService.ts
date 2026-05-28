/**
 * BrandDNAService — extracts the unique signature of a brand from its
 * past successful content, then provides a reusable "DNA prompt" that
 * conditions all future generations.
 *
 * Pipeline:
 *   1. sample past published posts (top N by analytics if available)
 *   2. add brand profile fields
 *   3. ask Claude to distill into: voice fingerprint, signature moves,
 *      narrative themes, vocabulary patterns, structural tics
 *   4. store as JSON on brand.profile.metadata or BrandProfile fields
 *   5. expose extractFor(brandId) + applyTo(prompt, brandId) for reuse
 */
import { AIRouterService } from '@/services/ai/AIRouterService';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface BrandDNA {
  voiceFingerprint: string;       // 2-3 sentences describing the voice as if you read 10 posts
  signatureMoves: string[];       // recurring rhetorical patterns ("opens with a stat", "uses 3-item lists")
  narrativeThemes: string[];      // recurring topics/angles
  vocabularyPatterns: {
    powerWords: string[];         // words that appear often & carry brand weight
    avoidedWords: string[];       // words conspicuously absent
    signaturePhrases: string[];   // multi-word fingerprints
  };
  structuralTics: string[];       // formatting/structure patterns (emoji use, line breaks, length)
  audienceSignals: string[];      // implicit reader they speak to
  sample: { count: number; source: string };
  extractedAt: string;
  mocked: boolean;
}

function mockDNA(brandName: string, sample: number): BrandDNA {
  return {
    voiceFingerprint: `[mock] Ton chaleureux et didactique pour ${brandName}, mix d'expertise et de proximité.`,
    signatureMoves: ['Ouvre par une question', 'Utilise des listes de 3', 'Termine par CTA action'],
    narrativeThemes: ['Croissance', 'Authenticité', 'Communauté'],
    vocabularyPatterns: {
      powerWords: ['ensemble', 'révéler', 'authentique'],
      avoidedWords: ['cheap', 'discount'],
      signaturePhrases: ['On y va?', 'Et toi, tu fais comment?'],
    },
    structuralTics: ['1 emoji par paragraphe', '3-4 lignes max par bloc', 'Saut de ligne avant CTA'],
    audienceSignals: ['Entrepreneurs 25-45', 'Sensibles à la communauté'],
    sample: { count: sample, source: 'mock' },
    extractedAt: new Date().toISOString(),
    mocked: true,
  };
}

export const BrandDNAService = {
  /**
   * Sample the brand's past published content (max 20 posts).
   */
  async sampleContent(brandId: string) {
    const posts = await db.post.findMany({
      where: {
        brandId,
        status: 'PUBLISHED',
        body: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { body: true, hashtags: true, cta: true, format: true },
    });
    return posts.filter((p) => p.body && p.body.length > 20);
  },

  async extractFor(brandId: string): Promise<BrandDNA> {
    const brand = await db.brand.findUnique({
      where: { id: brandId },
      include: { profile: true },
    });
    if (!brand) throw new Error('Brand not found');

    const samples = await this.sampleContent(brandId);
    if (samples.length < 3) {
      logger.info('BrandDNA: insufficient samples, returning brand-profile-based DNA', { brandId, sampleCount: samples.length });
      // If too few samples, derive DNA from brand profile only
    }

    const sampleBlock = samples.length === 0
      ? '(aucun post publié — utilise uniquement le profil)'
      : samples.map((p, i) => `[${i + 1}] (${p.format}) ${p.body?.slice(0, 500)}${p.cta ? `\nCTA: ${p.cta}` : ''}`).join('\n\n');

    const profileBlock = brand.profile ? [
      brand.profile.slogan ? `Slogan: ${brand.profile.slogan}` : '',
      brand.profile.mission ? `Mission: ${brand.profile.mission}` : '',
      brand.profile.toneOfVoice ? `Ton déclaré: ${brand.profile.toneOfVoice}` : '',
      brand.profile.audienceTarget ? `Cible: ${brand.profile.audienceTarget}` : '',
      brand.profile.values?.length ? `Valeurs: ${brand.profile.values.join(', ')}` : '',
      brand.profile.wordsToUse?.length ? `Mots à utiliser: ${brand.profile.wordsToUse.join(', ')}` : '',
      brand.profile.wordsToAvoid?.length ? `Mots à éviter: ${brand.profile.wordsToAvoid.join(', ')}` : '',
    ].filter(Boolean).join('\n') : '(pas de profil)';

    const systemPrompt = `Tu es un brand strategist senior. Tu extrais l'ADN d'une marque à partir de ses posts passés + profil.

Sortie OBLIGATOIRE en JSON valide:
{
  "voiceFingerprint": "2-3 phrases dignes d'un brand book — comme si tu avais lu 10 posts et expliquais le ton à un nouveau rédacteur",
  "signatureMoves": ["patterns rhétoriques récurrents — concret, pas générique"],
  "narrativeThemes": ["sujets/angles qui reviennent"],
  "vocabularyPatterns": {
    "powerWords": ["mots qui portent le poids de la marque"],
    "avoidedWords": ["mots conspicuously absents"],
    "signaturePhrases": ["expressions multi-mots qui font signature"]
  },
  "structuralTics": ["patterns format/structure (emoji, sauts de ligne, longueur)"],
  "audienceSignals": ["à qui ils parlent implicitement"]
}

Sois OBSERVATIONNEL — décris ce que tu vois vraiment, pas ce qu'une marque "devrait" être. Si peu de samples, dis-le et appuie-toi sur le profil.`;

    const userPrompt = `Marque: ${brand.name}
Industrie: ${brand.industry ?? 'non spécifiée'}

=== PROFIL DÉCLARÉ ===
${profileBlock}

=== ${samples.length} POSTS PUBLIÉS (échantillon) ===
${sampleBlock}

Extrais l'ADN observable. Rends le JSON.`;

    try {
      const result = await AIRouterService.generateTextForTask('TEXT_STRATEGIC', {
        prompt: userPrompt,
        systemPrompt,
        maxTokens: 2500,
        temperature: 0.4,
      });
      const match = result.text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in DNA response');
      const parsed = JSON.parse(match[0]) as Omit<BrandDNA, 'sample' | 'extractedAt' | 'mocked'>;
      return {
        ...parsed,
        sample: { count: samples.length, source: samples.length >= 3 ? 'published-posts' : 'profile-only' },
        extractedAt: new Date().toISOString(),
        mocked: result.mocked,
      };
    } catch (err) {
      logger.warn('Brand DNA extraction failed, fallback', { err: (err as Error).message });
      return mockDNA(brand.name, samples.length);
    }
  },

  /**
   * Persist DNA on BrandProfile.metadata-equivalent — stored on importantLinks JSON area.
   * (We don't add a new column to keep migrations minimal — use a JSON sub-key.)
   */
  async saveFor(brandId: string, dna: BrandDNA) {
    const profile = await db.brandProfile.findUnique({ where: { brandId } });
    if (!profile) {
      // Create minimal profile holding DNA
      await db.brandProfile.create({
        data: {
          brandId,
          importantLinks: { _dna: dna } as never,
        },
      });
      return;
    }
    const existing = (profile.importantLinks as Record<string, unknown>) ?? {};
    await db.brandProfile.update({
      where: { brandId },
      data: { importantLinks: { ...existing, _dna: dna } as never },
    });
  },

  async getStoredFor(brandId: string): Promise<BrandDNA | null> {
    const profile = await db.brandProfile.findUnique({ where: { brandId } });
    if (!profile) return null;
    const links = profile.importantLinks as Record<string, unknown> | null;
    const dna = links?._dna as BrandDNA | undefined;
    return dna ?? null;
  },

  /**
   * Build a system-prompt fragment that any generation can prepend to inherit the brand voice.
   */
  buildPromptFragment(dna: BrandDNA): string {
    return [
      '=== BRAND DNA (apply faithfully) ===',
      `Voix: ${dna.voiceFingerprint}`,
      dna.signatureMoves.length ? `Signatures: ${dna.signatureMoves.join(' | ')}` : '',
      dna.vocabularyPatterns.powerWords.length ? `Power words: ${dna.vocabularyPatterns.powerWords.join(', ')}` : '',
      dna.vocabularyPatterns.signaturePhrases.length ? `Phrases signature: ${dna.vocabularyPatterns.signaturePhrases.join(' / ')}` : '',
      dna.vocabularyPatterns.avoidedWords.length ? `À éviter: ${dna.vocabularyPatterns.avoidedWords.join(', ')}` : '',
      dna.structuralTics.length ? `Structure: ${dna.structuralTics.join(' | ')}` : '',
      dna.audienceSignals.length ? `Audience: ${dna.audienceSignals.join(' | ')}` : '',
      '=== END DNA ===',
    ].filter(Boolean).join('\n');
  },
};
