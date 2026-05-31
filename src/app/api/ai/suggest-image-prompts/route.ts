import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { BrandDNAService } from '@/services/intelligence/BrandDNAService';

const schema = z.object({
  brandId: z.string().optional(),
  format: z.string().optional(),
  subject: z.string().optional(),
});

export const maxDuration = 45;

/**
 * Suggest 4 professional, optimized AI image prompts tailored to the brand,
 * its DNA, its live marketing strategy, and the target format. Powers the
 * Design Studio "Suggérer des prompts" feature.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  const body = schema.parse(await req.json());

  let brandBlock = 'Aucune marque sélectionnée — propose des prompts génériques mais soignés.';
  let dnaFragment = '';
  let strategyBlock = '';

  if (body.brandId) {
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      include: { profile: true },
    });
    if (brand) {
      brandBlock = [
        `Marque : ${brand.name}`,
        brand.industry ? `Industrie : ${brand.industry}` : '',
        brand.profile?.slogan ? `Slogan : ${brand.profile.slogan}` : '',
        brand.profile?.audienceTarget ? `Cible : ${brand.profile.audienceTarget}` : '',
        brand.profile?.toneOfVoice ? `Ton : ${brand.profile.toneOfVoice}` : '',
        brand.profile?.visualStyle ? `Style visuel : ${brand.profile.visualStyle}` : '',
        brand.profile?.primaryColor ? `Couleurs : ${[brand.profile.primaryColor, brand.profile.secondaryColor, brand.profile.accentColor].filter(Boolean).join(', ')}` : '',
      ].filter(Boolean).join('\n');

      try {
        const dna = await BrandDNAService.getStoredFor(brand.id);
        if (dna) dnaFragment = BrandDNAService.buildPromptFragment(dna);
      } catch { /* ignore */ }

      // Pull a few recent strategy items as creative seeds.
      const items = await db.strategyItem.findMany({
        where: { strategy: { brandId: brand.id, organizationId: ctx.organizationId } },
        orderBy: { order: 'asc' },
        take: 6,
        select: { title: true, description: true, kind: true },
      });
      if (items.length) {
        strategyBlock = 'Items de la stratégie marketing en cours (inspire-toi-en) :\n' +
          items.map((i) => `- [${i.kind}] ${i.title}: ${i.description?.slice(0, 100)}`).join('\n');
      }
    }
  }

  const systemPrompt = [
    'Tu es directeur artistique senior spécialisé en visuels social media. Tu proposes',
    'des prompts d\'image PROFESSIONNELS, prêts pour un générateur (FLUX / DALL-E / Gemini).',
    '',
    'Réponds UNIQUEMENT en JSON valide :',
    '{ "prompts": ["prompt 1", "prompt 2", "prompt 3", "prompt 4"] }',
    '',
    'Chaque prompt doit :',
    '- être en ANGLAIS (meilleure performance des modèles)',
    '- décrire sujet, composition, cadrage, lumière, mood, palette, style',
    '- être cohérent avec la marque, son style visuel et sa stratégie',
    '- être adapté au format cible',
    '- éviter tout texte incrusté (sauf si explicitement demandé)',
    '- varier les angles créatifs entre les 4 propositions',
    dnaFragment ? `\n${dnaFragment}` : '',
  ].filter(Boolean).join('\n');

  const userPrompt = [
    brandBlock,
    body.format ? `\nFormat cible : ${body.format}` : '',
    body.subject ? `\nSujet souhaité : ${body.subject}` : '',
    strategyBlock ? `\n${strategyBlock}` : '',
    '\nPropose 4 prompts image distincts et optimisés. Rends le JSON.',
  ].filter(Boolean).join('\n');

  let prompts: string[] = [];
  let mocked = true;
  try {
    const result = await AIRouterService.generateTextForTask('TEXT_STRUCTURED_JSON', {
      prompt: userPrompt,
      systemPrompt,
      maxTokens: 1200,
      temperature: 0.8,
    });
    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { prompts?: unknown };
      if (Array.isArray(parsed.prompts)) {
        prompts = parsed.prompts.filter((p): p is string => typeof p === 'string').slice(0, 4);
        mocked = result.mocked;
      }
    }
  } catch { /* fall through to mock */ }

  if (prompts.length === 0) {
    const subj = body.subject || 'product lifestyle scene';
    prompts = [
      `Editorial photo of ${subj}, soft natural light, shallow depth of field, neutral palette, minimal composition`,
      `Lifestyle shot of ${subj}, urban background, golden hour, cinematic mood, premium feel`,
      `Studio product shot of ${subj}, clean white background, soft shadows, high detail`,
      `Flat lay of ${subj}, top-down view, tasteful props, muted tones, magazine style`,
    ];
  }

  return ok({ prompts, mocked });
});
