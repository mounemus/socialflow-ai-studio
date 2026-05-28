/**
 * Marketing/design tools for the Claude agent.
 * These are the "deep skills" the user mentioned — they wrap AIProviderService with
 * specialized prompts and structured outputs.
 */
import { db } from '@/lib/db';
import { AIProviderService } from '@/services/ai/AIProviderService';
import { CanvaService } from '@/services/canva/CanvaService';
import { CanvaConnectService } from '@/services/integrations/CanvaConnectService';
import type { ToolDefinition } from './tools';

async function loadBrandContext(brandId: string, organizationId: string) {
  const brand = await db.brand.findFirst({
    where: { id: brandId, organizationId },
    include: { profile: true },
  });
  if (!brand) return null;
  return {
    name: brand.name,
    slogan: brand.profile?.slogan,
    mission: brand.profile?.mission,
    values: brand.profile?.values ?? [],
    audienceTarget: brand.profile?.audienceTarget,
    toneOfVoice: brand.profile?.toneOfVoice,
    wordsToUse: brand.profile?.wordsToUse ?? [],
    wordsToAvoid: brand.profile?.wordsToAvoid ?? [],
    officialHashtags: brand.profile?.officialHashtags ?? [],
    primaryColor: brand.profile?.primaryColor,
    secondaryColor: brand.profile?.secondaryColor,
    accentColor: brand.profile?.accentColor,
    visualStyle: brand.profile?.visualStyle,
  };
}

export const MARKETING_TOOLS: ToolDefinition[] = [
  {
    name: 'generate_ad_copy',
    description: 'Generate ad copy variants (headlines + descriptions + CTA) for a paid campaign on a given platform.',
    input_schema: {
      type: 'object',
      required: ['brandId', 'platform', 'productOrOffer'],
      properties: {
        brandId: { type: 'string' },
        platform: { type: 'string', enum: ['META', 'GOOGLE', 'LINKEDIN', 'TIKTOK', 'X'] },
        productOrOffer: { type: 'string', description: 'Product, service, or offer to promote' },
        objective: { type: 'string', description: 'awareness | consideration | conversion | retargeting', default: 'conversion' },
        variantsCount: { type: 'number', default: 3, minimum: 1, maximum: 8 },
        budgetHint: { type: 'string', description: 'optional: budget context' },
      },
    },
    async run(input, ctx) {
      const brand = await loadBrandContext(input.brandId as string, ctx.organizationId);
      if (!brand) throw new Error('Brand not found');
      const n = (input.variantsCount as number) ?? 3;
      const prompt = `Génère ${n} variantes complètes d'ad copy pour ${input.platform}.
Produit/offre: ${input.productOrOffer}
Objectif: ${input.objective ?? 'conversion'}
${input.budgetHint ? `Budget: ${input.budgetHint}` : ''}

Pour CHAQUE variante, retourne :
- headline (max 40 caractères)
- primary text (max 125 caractères)
- description (max 30 caractères)
- CTA button suggéré
- target audience hint (1 phrase)

Format JSON :
{ "variants": [ { "headline": "...", "primary_text": "...", "description": "...", "cta": "...", "audience": "..." } ] }

Adapte au format ${input.platform}.`;
      const out = await AIProviderService.generateText({
        prompt,
        brandContext: brand,
        maxTokens: 1500,
      });
      try {
        const match = out.text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { raw: out.text };
      } catch {
        return { raw: out.text, mocked: out.mocked };
      }
    },
  },

  {
    name: 'generate_email_campaign',
    description: 'Generate a marketing email: subject lines (A/B), preheader, body, CTA, plain-text alt.',
    input_schema: {
      type: 'object',
      required: ['brandId', 'topic'],
      properties: {
        brandId: { type: 'string' },
        topic: { type: 'string' },
        audienceSegment: { type: 'string' },
        type: { type: 'string', enum: ['newsletter', 'product_launch', 'promo', 'welcome', 'reengagement'], default: 'newsletter' },
        length: { type: 'string', enum: ['short', 'medium', 'long'], default: 'medium' },
      },
    },
    async run(input, ctx) {
      const brand = await loadBrandContext(input.brandId as string, ctx.organizationId);
      if (!brand) throw new Error('Brand not found');
      const prompt = `Crée un email marketing type "${input.type}" sur le sujet "${input.topic}".
${input.audienceSegment ? `Segment: ${input.audienceSegment}` : ''}
Longueur: ${input.length}.

Retourne JSON :
{
  "subject_a": "...",
  "subject_b": "...",
  "preheader": "...",
  "body_html": "<p>...</p>",
  "body_plain": "...",
  "cta_text": "...",
  "cta_url": "{{PLACEHOLDER}}",
  "send_time_hint": "Tuesday 10am",
  "personalization_vars": ["first_name", "company"]
}`;
      const out = await AIProviderService.generateText({ prompt, brandContext: brand, maxTokens: 2000 });
      try {
        const match = out.text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { raw: out.text };
      } catch {
        return { raw: out.text };
      }
    },
  },

  {
    name: 'generate_landing_page_copy',
    description: 'Generate full landing page copy: hero, USPs, social proof, FAQ, CTA sections.',
    input_schema: {
      type: 'object',
      required: ['brandId', 'productOrOffer'],
      properties: {
        brandId: { type: 'string' },
        productOrOffer: { type: 'string' },
        targetAudience: { type: 'string' },
        primaryGoal: { type: 'string', description: 'signup | purchase | trial | demo | newsletter', default: 'signup' },
      },
    },
    async run(input, ctx) {
      const brand = await loadBrandContext(input.brandId as string, ctx.organizationId);
      if (!brand) throw new Error('Brand not found');
      const prompt = `Crée le copy complet d'une landing page pour "${input.productOrOffer}".
Objectif: ${input.primaryGoal}.
Audience: ${input.targetAudience ?? brand.audienceTarget ?? 'à définir'}.

Retourne JSON :
{
  "hero": { "headline": "...", "subheadline": "...", "cta_primary": "...", "cta_secondary": "..." },
  "value_props": [{ "title": "...", "description": "...", "icon_hint": "..." }],
  "usps": ["..."],
  "social_proof_hooks": ["Used by X+ companies", "..."],
  "features": [{ "title": "...", "description": "..." }],
  "objections_addressed": [{ "objection": "...", "answer": "..." }],
  "faq": [{ "q": "...", "a": "..." }],
  "final_cta": { "headline": "...", "body": "...", "button": "..." }
}`;
      const out = await AIProviderService.generateText({ prompt, brandContext: brand, maxTokens: 3000 });
      try {
        const match = out.text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { raw: out.text };
      } catch {
        return { raw: out.text };
      }
    },
  },

  {
    name: 'repurpose_content',
    description: 'Take one source post and produce variants for multiple platforms (each adapted to character limits & format).',
    input_schema: {
      type: 'object',
      required: ['sourcePostId', 'targetPlatforms'],
      properties: {
        sourcePostId: { type: 'string' },
        targetPlatforms: {
          type: 'array',
          items: { type: 'string', enum: ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'] },
        },
        saveAsDrafts: { type: 'boolean', default: true },
      },
    },
    async run(input, ctx) {
      const source = await db.post.findFirst({
        where: { id: input.sourcePostId as string, organizationId: ctx.organizationId },
        include: { brand: { include: { profile: true } } },
      });
      if (!source) throw new Error('Source post not found');
      const platforms = input.targetPlatforms as string[];
      const variants: Array<{ platform: string; text: string; postId?: string }> = [];

      const brandCtx = source.brand
        ? {
            name: source.brand.name,
            toneOfVoice: source.brand.profile?.toneOfVoice,
            audienceTarget: source.brand.profile?.audienceTarget,
            officialHashtags: source.brand.profile?.officialHashtags ?? [],
            wordsToUse: source.brand.profile?.wordsToUse ?? [],
            wordsToAvoid: source.brand.profile?.wordsToAvoid ?? [],
          }
        : undefined;

      for (const platform of platforms) {
        const limits: Record<string, number> = { INSTAGRAM: 2200, FACEBOOK: 5000, LINKEDIN: 3000, TWITTER: 280, TIKTOK: 2200, YOUTUBE: 5000, PINTEREST: 500 };
        const prompt = `Réécris ce post pour ${platform} (max ${limits[platform] ?? 1000} caractères, ton + format adaptés à la plateforme):\n\n${source.body ?? ''}\n\nGarde l'esprit mais adapte le format.`;
        const out = await AIProviderService.generateText({ prompt, brandContext: brandCtx, platform, maxTokens: 600 });
        const variant: { platform: string; text: string; postId?: string } = { platform, text: out.text };
        if (input.saveAsDrafts !== false) {
          const formatMap: Record<string, string> = { INSTAGRAM: 'INSTAGRAM_POST', FACEBOOK: 'FACEBOOK_POST', LINKEDIN: 'LINKEDIN_POST', TWITTER: 'TWITTER_POST', TIKTOK: 'TIKTOK_VIDEO', YOUTUBE: 'YOUTUBE_SHORT', PINTEREST: 'PINTEREST_PIN' };
          const p = await db.post.create({
            data: {
              organizationId: ctx.organizationId,
              authorId: ctx.userId,
              brandId: source.brandId,
              status: 'AI_GENERATED',
              format: (formatMap[platform] ?? 'INSTAGRAM_POST') as never,
              language: source.language,
              body: out.text,
              hashtags: source.hashtags,
              aiPrompt: `repurpose from ${source.id}`,
              aiProvider: out.provider,
            },
          });
          variant.postId = p.id;
        }
        variants.push(variant);
      }
      return { variants };
    },
  },

  {
    name: 'generate_seo_keywords',
    description: 'Generate SEO keyword research for a topic: primary, secondary, long-tail with intent and difficulty estimates.',
    input_schema: {
      type: 'object',
      required: ['topic'],
      properties: {
        topic: { type: 'string' },
        language: { type: 'string', default: 'fr' },
        market: { type: 'string', description: 'e.g., FR, US, BENELUX' },
      },
    },
    async run(input) {
      const prompt = `Recherche SEO pour le sujet "${input.topic}".
Marché: ${input.market ?? 'France'}. Langue: ${input.language}.

Retourne JSON :
{
  "primary_keywords": [{ "keyword": "...", "intent": "informational|commercial|transactional", "difficulty": "low|medium|high", "search_volume_estimate": "..." }],
  "secondary_keywords": [...],
  "long_tail": [...],
  "questions_users_ask": ["..."],
  "content_pillars_suggested": ["..."]
}`;
      const out = await AIProviderService.generateText({ prompt, language: input.language as string, maxTokens: 2000 });
      try {
        const match = out.text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { raw: out.text };
      } catch {
        return { raw: out.text };
      }
    },
  },

  {
    name: 'generate_design_brief',
    description: 'Generate a complete design brief with palette, typography, composition, and copy variants. Includes Canva brief when relevant.',
    input_schema: {
      type: 'object',
      required: ['brandId', 'format', 'topic'],
      properties: {
        brandId: { type: 'string' },
        format: { type: 'string', description: 'e.g. INSTAGRAM_POST, FLYER, AD_VISUAL, PRESENTATION' },
        topic: { type: 'string' },
        mood: { type: 'string', description: 'energetic | calm | premium | playful | etc.' },
        includeCanvaBrief: { type: 'boolean', default: true },
      },
    },
    async run(input, ctx) {
      const brand = await loadBrandContext(input.brandId as string, ctx.organizationId);
      if (!brand) throw new Error('Brand not found');
      const prompt = `Brief de design complet.
Format: ${input.format}.
Sujet: ${input.topic}.
${input.mood ? `Ambiance: ${input.mood}.` : ''}

Retourne JSON :
{
  "concept": "1-2 phrases résumant l'idée visuelle",
  "palette": { "primary": "#HEX", "secondary": "#HEX", "accent": "#HEX", "background": "#HEX" },
  "typography": { "headline": "type/font hint", "body": "..." },
  "composition": "description de la mise en page",
  "key_elements": ["..."],
  "copy_options": [{ "headline": "...", "subheadline": "...", "cta": "..." }],
  "image_prompt_dalle": "prompt prêt pour AI image",
  "do_not_do": ["..."]
}

Respecte la charte de la marque (palette ${brand.primaryColor ?? 'à définir'}).`;
      const out = await AIProviderService.generateText({ prompt, brandContext: brand, maxTokens: 2000 });
      let parsed: Record<string, unknown> | null = null;
      try {
        const match = out.text.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : null;
      } catch {
        parsed = null;
      }
      const result: Record<string, unknown> = { brief: parsed ?? { raw: out.text } };
      if (input.includeCanvaBrief !== false) {
        result.canva_brief = CanvaService.generateCanvaBrief({
          brandName: brand.name,
          format: input.format as string,
          topic: input.topic as string,
          tone: brand.toneOfVoice ?? undefined,
          audience: brand.audienceTarget ?? undefined,
          primaryColor: brand.primaryColor ?? undefined,
          visualStyle: brand.visualStyle ?? undefined,
        });
      }
      return result;
    },
  },

  {
    name: 'analyze_brand_consistency',
    description: 'Check if a piece of content matches the brand voice and guidelines. Returns a score + specific suggestions.',
    input_schema: {
      type: 'object',
      required: ['brandId', 'content'],
      properties: {
        brandId: { type: 'string' },
        content: { type: 'string' },
      },
    },
    async run(input, ctx) {
      const brand = await loadBrandContext(input.brandId as string, ctx.organizationId);
      if (!brand) throw new Error('Brand not found');
      const prompt = `Analyse la cohérence de ce contenu avec la marque.

CONTENU À ANALYSER :
"${input.content}"

CRITÈRES :
- Respect du ton "${brand.toneOfVoice ?? 'à définir'}"
- Présence/absence des mots à utiliser : ${brand.wordsToUse?.join(', ') || 'aucun'}
- Présence/absence des mots à éviter : ${brand.wordsToAvoid?.join(', ') || 'aucun'}
- Alignement avec audience : ${brand.audienceTarget ?? 'à définir'}

Retourne JSON :
{
  "score": 0-100,
  "tone_match": "ok|drift|off",
  "issues": [{ "type": "...", "where": "...", "fix": "..." }],
  "improvements": ["..."],
  "rewritten_version": "..."
}`;
      const out = await AIProviderService.generateText({ prompt, brandContext: brand, maxTokens: 1500 });
      try {
        const match = out.text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { raw: out.text };
      } catch {
        return { raw: out.text };
      }
    },
  },

  {
    name: 'generate_strategic_calendar',
    description: 'Generate a strategic content calendar with themes, content pillars, posting cadence, and KPIs (not just N posts).',
    input_schema: {
      type: 'object',
      required: ['brandId', 'durationWeeks'],
      properties: {
        brandId: { type: 'string' },
        durationWeeks: { type: 'number', minimum: 1, maximum: 12 },
        strategicGoal: { type: 'string', description: 'awareness | growth | conversion | retention' },
        platforms: { type: 'array', items: { type: 'string' } },
      },
    },
    async run(input, ctx) {
      const brand = await loadBrandContext(input.brandId as string, ctx.organizationId);
      if (!brand) throw new Error('Brand not found');
      const prompt = `Plan éditorial stratégique sur ${input.durationWeeks} semaines pour ${brand.name}.
Objectif : ${input.strategicGoal ?? 'awareness'}.
Plateformes : ${(input.platforms as string[])?.join(', ') ?? 'Instagram, LinkedIn'}.

Retourne JSON :
{
  "strategic_goal": "...",
  "content_pillars": [{ "name": "...", "description": "...", "weight_pct": 0-100 }],
  "cadence_recommendation": { "INSTAGRAM": "3/sem", "LINKEDIN": "2/sem" },
  "themes_per_week": [{ "week": 1, "theme": "...", "rationale": "..." }],
  "kpis_to_track": ["..."],
  "experiments_to_run": ["..."],
  "risks": ["..."]
}`;
      const out = await AIProviderService.generateText({ prompt, brandContext: brand, maxTokens: 3000 });
      try {
        const match = out.text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { raw: out.text };
      } catch {
        return { raw: out.text };
      }
    },
  },

  {
    name: 'create_canva_design_from_template',
    description: 'Create a new Canva design from a template URL or template id. Requires active Canva connection on the org.',
    input_schema: {
      type: 'object',
      required: ['brandId', 'templateUrl'],
      properties: {
        brandId: { type: 'string' },
        templateUrl: { type: 'string' },
        title: { type: 'string' },
        brief: { type: 'string' },
      },
    },
    async run(input, ctx) {
      const hasConnection = await CanvaService.hasActiveConnection(ctx.organizationId);
      const summary = await CanvaService.createFromTemplate(
        {
          brandId: input.brandId as string,
          templateUrl: input.templateUrl as string,
          title: input.title as string | undefined,
          brief: input.brief as string | undefined,
        },
        ctx.organizationId,
      );
      return { ...summary, liveApi: hasConnection };
    },
  },

  {
    name: 'list_canva_designs',
    description: 'List both live Canva designs (if connected) and manually-linked Canva URLs.',
    input_schema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const apiEnabled = CanvaService.isApiEnabled();
      const hasConnection = await CanvaService.hasActiveConnection(ctx.organizationId);
      const designs = await CanvaService.listCanvaDesigns(ctx.organizationId);
      return { apiEnabled, hasConnection, count: designs.length, designs };
    },
  },

  {
    name: 'generate_image',
    description: 'Generate an AI image (Replicate FLUX or Stability AI). Saves to media library. Returns URLs.',
    input_schema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'image description, best in English' },
        aspectRatio: { type: 'string', enum: ['1:1', '4:5', '9:16', '16:9'], default: '1:1' },
        styleHint: { type: 'string', description: 'e.g. "photorealistic, studio lighting"' },
        variants: { type: 'number', minimum: 1, maximum: 4, default: 1 },
        brandId: { type: 'string', description: 'optional - auto-applies brand visual style' },
      },
    },
    async run(input, ctx) {
      const prompt = input.prompt as string;
      const variants = (input.variants as number) ?? 1;
      const results: Array<{ url?: string; mediaId?: string; error?: string }> = [];

      // Enrich with brand style if provided
      let enrichedPrompt = prompt;
      if (input.brandId) {
        const brand = await db.brand.findFirst({
          where: { id: input.brandId as string, organizationId: ctx.organizationId },
          include: { profile: true },
        });
        if (brand?.profile?.visualStyle) {
          enrichedPrompt = `${prompt}, ${brand.profile.visualStyle}`;
        }
      }

      const promises = Array.from({ length: variants }, () =>
        AIProviderService.generateImage({
          prompt: enrichedPrompt,
          aspectRatio: (input.aspectRatio as never) ?? '1:1',
          styleHint: input.styleHint as string | undefined,
        }).catch((err) => ({ url: '', provider: 'error', mocked: false, error: (err as Error).message })),
      );
      const generated = await Promise.all(promises);

      for (const g of generated) {
        if ('error' in g || !g.url) {
          results.push({ error: 'error' in g ? g.error : 'empty url' });
          continue;
        }
        let mediaId: string | undefined;
        if (!g.url.startsWith('data:')) {
          const media = await db.mediaAsset.create({
            data: {
              organizationId: ctx.organizationId,
              brandId: input.brandId as string | undefined,
              kind: 'IMAGE',
              url: g.url,
              source: 'ai',
              mimeType: 'image/png',
              altText: prompt.slice(0, 200),
              metadata: { prompt, provider: g.provider, aspectRatio: input.aspectRatio } as never,
            },
          });
          mediaId = media.id;
        }
        results.push({ url: g.url, mediaId });
      }
      return { images: results, promptUsed: enrichedPrompt };
    },
  },
  {
    name: 'check_canva_connection',
    description: 'Diagnose the Canva integration: is the API key set, is the OAuth connection active, when does it expire.',
    input_schema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const apiEnabled = CanvaService.isApiEnabled();
      const hasConnection = await CanvaService.hasActiveConnection(ctx.organizationId);
      const integration = await db.userIntegration.findFirst({
        where: { organizationId: ctx.organizationId, provider: 'CANVA', active: true },
        select: { displayName: true, scope: true, expiresAt: true, createdAt: true },
      });
      let token = null;
      if (hasConnection) {
        try {
          await CanvaConnectService.getCurrentUser(ctx.organizationId);
          token = 'valid';
        } catch (err) {
          token = `error: ${(err as Error).message}`;
        }
      }
      return { apiEnabled, hasConnection, integration, token };
    },
  },
];
