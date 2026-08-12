import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { sanitizeSocialText } from '@/lib/social-text';
import { AIProviderService } from '@/services/ai/AIProviderService';
import { AIModelPreferenceService } from '@/services/ai/AIModelPreferenceService';
import { BrandDNAService } from '@/services/intelligence/BrandDNAService';

const schema = z.object({
  brandId: z.string().optional(),
  platform: z.string().optional(),
  format: z.string().optional(),
  language: z.string().default('fr'),
  tone: z.string().optional(),
  audience: z.string().optional(),
  prompt: z.string().min(3),
  cta: z.string().optional(),
  saveAsDraft: z.boolean().default(false),
  // Corps de post existant (template à trous) à utiliser comme structure —
  // le modèle doit remplacer chaque [segment entre crochets] par du contenu réel.
  draft: z.string().max(4000).optional(),
  // Post en cours d'édition — sert à retrouver la stratégie d'origine (piliers).
  postId: z.string().optional(),
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  let brandContext: Parameters<typeof AIProviderService.generateText>[0]['brandContext'] | undefined;
  if (body.brandId) {
    const brand = await db.brand.findFirst({
      where: { id: body.brandId, organizationId: ctx.organizationId },
      include: { profile: true },
    });
    if (brand) {
      brandContext = {
        name: brand.name,
        slogan: brand.profile?.slogan,
        mission: brand.profile?.mission,
        values: brand.profile?.values ?? [],
        audienceTarget: brand.profile?.audienceTarget,
        toneOfVoice: brand.profile?.toneOfVoice,
        wordsToUse: brand.profile?.wordsToUse ?? [],
        wordsToAvoid: brand.profile?.wordsToAvoid ?? [],
        officialHashtags: brand.profile?.officialHashtags ?? [],
      };
    }
  }

  // === BrandDNA auto-application (H3.2) ===
  // If brand has a stored DNA, prepend its prompt fragment to enforce voice consistency.
  let dnaFragment = '';
  if (body.brandId) {
    const dna = await BrandDNAService.getStoredFor(body.brandId);
    if (dna) dnaFragment = BrandDNAService.buildPromptFragment(dna);
  }

  // === Piliers de contenu de la stratégie d'origine ===
  // Un post créé depuis un item de stratégie porte metadata.fromStrategyItem :
  // on remonte à la stratégie et on injecte ses piliers dans le contexte, pour
  // que le contenu généré reste aligné sur la direction validée.
  let strategyFragment = '';
  let strategyApplied: string | null = null;
  if (body.postId) {
    const post = await db.post.findFirst({
      where: { id: body.postId, organizationId: ctx.organizationId },
      select: { metadata: true },
    });
    const itemId = (post?.metadata as { fromStrategyItem?: string } | null)?.fromStrategyItem;
    if (itemId) {
      const item = await db.strategyItem.findUnique({
        where: { id: itemId },
        include: { strategy: { select: { title: true, strategy: true, organizationId: true } } },
      });
      if (item?.strategy && item.strategy.organizationId === ctx.organizationId) {
        const s = item.strategy.strategy as {
          content_pillars?: Array<{ name?: string; description?: string; weight_pct?: number }>;
          positioning?: { unique_value?: string };
        } | null;
        const pillars = (s?.content_pillars ?? []).filter((p) => p?.name);
        if (pillars.length > 0) {
          strategyApplied = item.strategy.title;
          strategyFragment =
            `=== STRATÉGIE DE MARQUE — « ${item.strategy.title} » ===\n` +
            (s?.positioning?.unique_value ? `Proposition de valeur : ${s.positioning.unique_value}\n` : '') +
            'Piliers de contenu (aligne ce post sur le pilier le plus pertinent) :\n' +
            pillars
              .map((p) => `- ${p.name}${p.weight_pct ? ` (${p.weight_pct} %)` : ''}${p.description ? ` : ${p.description}` : ''}`)
              .join('\n');
        }
      }
    }
  }

  // Anti-échafaudage : soit on impose la structure du brouillon existant (chaque
  // [crochet] doit être remplacé), soit on interdit explicitement d'en laisser.
  const userPrompt = body.draft
    ? `${body.prompt}\n\nSTRUCTURE À SUIVRE (remplace CHAQUE segment entre crochets par du contenu concret et spécifique à la marque — il est INTERDIT de laisser des crochets dans le texte final) :\n${body.draft}`
    : `${body.prompt}\n\nRÈGLE ABSOLUE : ne laisse JAMAIS de segments entre crochets [comme ceci] ni de champs à compléter — écris un texte final, concret, prêt à publier.`;

  const start = Date.now();
  const prefs = await AIModelPreferenceService.forOrg(ctx.organizationId);
  const contextBlocks = [dnaFragment, strategyFragment].filter(Boolean).join('\n\n');
  const result = await AIProviderService.generateText(AIModelPreferenceService.applyText({
    prompt: contextBlocks ? `${contextBlocks}\n\n=== BRIEF UTILISATEUR ===\n${userPrompt}` : userPrompt,
    platform: body.platform,
    format: body.format as never,
    language: body.language,
    tone: body.tone,
    audience: body.audience,
    cta: body.cta,
    brandContext,
  }, prefs));

  await db.aIRequest.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      type: 'TEXT',
      prompt: body.prompt,
      response: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      success: true,
      metadata: { provider: result.provider, mocked: result.mocked },
    },
  });

  let post = null;
  if (body.saveAsDraft) {
    post = await db.post.create({
      data: {
        organizationId: ctx.organizationId,
        authorId: ctx.userId,
        brandId: body.brandId,
        status: 'AI_GENERATED',
        format: (body.format ?? 'INSTAGRAM_POST') as never,
        language: body.language,
        body: sanitizeSocialText(result.text),
        hashtags: result.hashtags ?? [],
        cta: body.cta,
        aiPrompt: body.prompt,
        aiProvider: result.provider,
        aiModel: result.model,
      },
    });
  }

  // Le texte est nettoyé de son échafaudage markdown : les réseaux ne rendent
  // ni les titres `#`, ni les `---`, ni les `**gras**` — ils les publiaient tels quels.
  return ok({ ...result, text: sanitizeSocialText(result.text), totalMs: Date.now() - start, post, strategyApplied });
});
