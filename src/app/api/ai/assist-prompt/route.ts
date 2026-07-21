import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIRouterService } from '@/services/ai/AIRouterService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  /** Type de création à assister — pilote les consignes de rédaction. */
  kind: z.enum(['text', 'image', 'carousel', 'video', 'canva']),
  /** Intention brute de l'utilisateur (peut être vide : on part de la marque). */
  draft: z.string().max(4000).optional(),
  brandId: z.string().optional(),
  platform: z.string().optional(),
  format: z.string().optional(),
});

/** Consignes par type de création. Les prompts image/vidéo sont en anglais
 *  (meilleurs résultats sur les générateurs), les textes dans la langue de la marque. */
const GUIDE: Record<string, string> = {
  text: [
    "Tu rédiges le BRIEF d'un post social. Produis un brief actionnable :",
    'angle éditorial, promesse concrète, structure (accroche / corps / CTA), et ton.',
    'Reste dans la langue du brief fourni. Pas de hashtags, pas de emoji décoratifs.',
  ].join(' '),
  image: [
    'You write PROMPTS for an AI image generator. Output ONE English prompt, one paragraph.',
    'Describe: subject, composition, camera/lens or illustration style, lighting, palette, mood, background.',
    'Be concrete and visual. Never mention brand names, logos or readable text unless explicitly asked.',
  ].join(' '),
  carousel: [
    'You write PROMPTS for a consistent AI-generated carousel. Output ONE English prompt describing',
    'the shared visual system (style, palette, composition grid, lighting) so every slide matches.',
  ].join(' '),
  video: [
    'You write PROMPTS for an AI text-to-video generator. Output ONE English prompt, one paragraph:',
    'subject and action, camera movement, shot scale, lighting, pace and mood. Keep it under 80 words.',
  ].join(' '),
  canva: [
    'Tu rédiges les valeurs de remplissage pour un template Canva : titre court et percutant,',
    'sous-titre explicatif, et accroche. Reste dans la langue du brief.',
  ].join(' '),
};

/**
 * POST /api/ai/assist-prompt — assistance à la rédaction de prompt.
 *
 * Un prompt vague donne un résultat vague : cet endpoint transforme une
 * intention brute en prompt exploitable, enrichi du contexte de la marque
 * (ton, audience, style visuel, couleurs). Routé sur GPT — rapide, économique
 * et fiable pour de la réécriture courte. En cas d'indisponibilité, la chaîne
 * de secours du routeur prend le relais ; si tout échoue, on le dit.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  let brandContext = '';
  if (body.brandId) {
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      select: {
        name: true,
        industry: true,
        profile: {
          select: {
            toneOfVoice: true,
            audienceTarget: true,
            visualStyle: true,
            primaryColor: true,
            secondaryColor: true,
            wordsToUse: true,
            wordsToAvoid: true,
          },
        },
      },
    });
    if (brand) {
      const p = brand.profile;
      brandContext = [
        `Marque: ${brand.name}${brand.industry ? ` (${brand.industry})` : ''}`,
        p?.toneOfVoice ? `Ton: ${p.toneOfVoice}` : '',
        p?.audienceTarget ? `Audience: ${p.audienceTarget}` : '',
        p?.visualStyle ? `Style visuel: ${p.visualStyle}` : '',
        p?.primaryColor ? `Couleurs: ${p.primaryColor}${p.secondaryColor ? ` / ${p.secondaryColor}` : ''}` : '',
        p?.wordsToUse?.length ? `Mots à privilégier: ${p.wordsToUse.join(', ')}` : '',
        p?.wordsToAvoid?.length ? `Mots à éviter: ${p.wordsToAvoid.join(', ')}` : '',
      ].filter(Boolean).join('\n');
    }
  }

  const systemPrompt = [
    GUIDE[body.kind] ?? GUIDE.text,
    '',
    "Réponds UNIQUEMENT par le prompt final, sans préambule, sans guillemets,",
    'sans commentaire et sans liste à puces.',
  ].join('\n');

  const userPrompt = [
    brandContext ? `CONTEXTE DE MARQUE\n${brandContext}` : '',
    body.platform ? `Plateforme: ${body.platform}` : '',
    body.format ? `Format: ${body.format}` : '',
    '',
    body.draft?.trim()
      ? `INTENTION DE L'UTILISATEUR\n${body.draft.trim()}`
      : "L'utilisateur n'a pas encore d'intention précise : propose une idée forte et cohérente avec la marque.",
  ].filter(Boolean).join('\n');

  const result = await AIRouterService.generateTextForTask('TEXT_SHORT_COPY', {
    prompt: userPrompt,
    systemPrompt,
    maxTokens: 700,
    // GPT est le meilleur compromis vitesse/coût/fiabilité pour de la
    // réécriture courte. Le routeur garde ses fallbacks si GPT est indisponible.
    forceProvider: 'gpt',
  });

  const prompt = result.text.trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!prompt) {
    // Vérité opérationnelle : pas de prompt inventé côté client.
    return ok({ ok: false, reason: 'Le fournisseur n’a renvoyé aucun texte.', prompt: '' });
  }

  return ok({ ok: true, prompt, provider: result.provider, mocked: result.mocked });
});
