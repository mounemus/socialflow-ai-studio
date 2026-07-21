/**
 * promptBuilders.ts — type-aware prompt builders for the Concretization service (acte 4).
 *
 * Each StrategyItem kind has its own builder. A builder returns:
 *   - imagePrompt        : the prompt fed to the image generator (English, for best provider perf)
 *   - videoScriptPrompt  : the user prompt fed to TEXT_REEL_SCRIPT (if relevant)
 *   - captionPrompt      : the user prompt fed to the text generator for the social caption
 *   - emailObjectPrompt  : email subject prompt (EMAIL_IDEA only)
 *   - emailBodyPrompt    : email body prompt (EMAIL_IDEA only)
 *   - aspectRatio        : platform-correct visual ratio (1.91:1 is exposed for LinkedIn; the
 *                          ConcretizationService maps it to the closest supported generator ratio)
 *   - recommendedProvider: routing hint ('gemini' | 'dalle' | 'flux' | 'claude')
 *
 * BrandDNA fragment (BrandDNAService.buildPromptFragment) is injected when available.
 */
import type { StrategyItem, Brand, BrandProfile } from '@prisma/client';
import { BrandDNAService, type BrandDNA } from '@/services/intelligence/BrandDNAService';

// =================================================================
// TYPES
// =================================================================

export type ConcretizationAspect = '1:1' | '4:5' | '9:16' | '16:9' | '1.91:1';
export type RecommendedProvider = 'gemini' | 'dalle' | 'flux' | 'claude' | 'fal';

export interface BuilderInput {
  item: StrategyItem;
  brand: Pick<Brand, 'id' | 'name' | 'industry'> | null;
  brandProfile?: BrandProfile | null;
  brandDna?: BrandDNA | null;
}

export interface BuilderOutput {
  imagePrompt?: string;
  videoScriptPrompt?: string;
  captionPrompt: string;
  emailObjectPrompt?: string;
  emailBodyPrompt?: string;
  aspectRatio: ConcretizationAspect;
  recommendedProvider: RecommendedProvider;
}

// =================================================================
// HELPERS
// =================================================================

/**
 * Pick aspect ratio from the StrategyItem.platform + format hints.
 * Supports '1.91:1' for LinkedIn shares (1200×627).
 */
export function aspectRatioForItem(item: Pick<StrategyItem, 'platform' | 'format' | 'kind'>): ConcretizationAspect {
  const platform = String(item.platform ?? '').toLowerCase();
  const format = String(item.format ?? '').toLowerCase();

  // Vertical
  if (
    format.includes('reel') || format.includes('story') || format.includes('short') ||
    format.includes('tiktok') || format.includes('vertical') ||
    platform.includes('tiktok') || platform.includes('reel') ||
    platform.includes('story') || platform.includes('short')
  ) {
    return '9:16';
  }
  // YouTube / wide banners
  if (
    format.includes('thumbnail') || format.includes('banner') || format.includes('youtube') ||
    platform.includes('youtube')
  ) {
    return '16:9';
  }
  // LinkedIn = 1.91:1 (link post optimum 1200x627)
  if (platform.includes('linkedin')) {
    return '1.91:1';
  }
  // Pinterest = tall 2:3 — closest supported = 4:5
  if (format.includes('pinterest') || platform.includes('pinterest')) {
    return '4:5';
  }
  // Instagram carousel/feed = portrait 4:5
  if (
    format.includes('carousel') || format.includes('instagram') ||
    platform.includes('instagram')
  ) {
    return '4:5';
  }
  // Default square for ads / generic / Facebook
  return '1:1';
}

/**
 * Build the brand-context block prepended to every prompt.
 * Includes the optional BrandDNA fragment when present.
 */
function brandContextBlock(input: BuilderInput): string {
  const lines: string[] = [];
  if (input.brand) {
    lines.push(`Brand: ${input.brand.name}${input.brand.industry ? ` (${input.brand.industry})` : ''}`);
  }
  if (input.brandProfile?.slogan) lines.push(`Slogan: ${input.brandProfile.slogan}`);
  if (input.brandProfile?.mission) lines.push(`Mission: ${input.brandProfile.mission}`);
  if (input.brandProfile?.toneOfVoice) lines.push(`Tone: ${input.brandProfile.toneOfVoice}`);
  if (input.brandProfile?.audienceTarget) lines.push(`Audience: ${input.brandProfile.audienceTarget}`);
  if (input.brandProfile?.values?.length) lines.push(`Values: ${input.brandProfile.values.join(', ')}`);
  if (input.brandProfile?.wordsToUse?.length) lines.push(`Power words: ${input.brandProfile.wordsToUse.join(', ')}`);
  if (input.brandProfile?.wordsToAvoid?.length) lines.push(`Avoid: ${input.brandProfile.wordsToAvoid.join(', ')}`);
  if (input.brandProfile?.officialHashtags?.length) lines.push(`Official hashtags: ${input.brandProfile.officialHashtags.join(' ')}`);
  if (input.brandProfile?.primaryColor) {
    const palette = [
      input.brandProfile.primaryColor,
      input.brandProfile.secondaryColor,
      input.brandProfile.accentColor,
    ].filter(Boolean).join(', ');
    lines.push(`Palette: ${palette}`);
  }
  if (input.brandProfile?.visualStyle) lines.push(`Visual style: ${input.brandProfile.visualStyle}`);

  if (input.brandDna) {
    lines.push('');
    lines.push(BrandDNAService.buildPromptFragment(input.brandDna));
  }
  return lines.join('\n');
}

/**
 * Visual style fragment reused across image prompts so multi-image series
 * (carousels) stay consistent.
 */
function visualStyleFragment(input: BuilderInput): string {
  const profile = input.brandProfile;
  const bits: string[] = [];
  if (profile?.visualStyle) bits.push(profile.visualStyle);
  if (profile?.primaryColor) {
    bits.push(`brand palette around ${profile.primaryColor}${profile.secondaryColor ? ` and ${profile.secondaryColor}` : ''}`);
  }
  bits.push('high quality, photorealistic where appropriate, balanced composition, editorial lighting');
  return bits.join(', ');
}

// =================================================================
// BUILDERS PER KIND
// =================================================================

export function buildForPostIdea(input: BuilderInput): BuilderOutput {
  const { item } = input;
  const aspect = aspectRatioForItem(item);
  const ctx = brandContextBlock(input);
  const style = visualStyleFragment(input);

  const imagePrompt = [
    `Editorial social media image for post titled "${item.title}".`,
    item.description ? `Concept: ${item.description}` : '',
    item.platform ? `Platform: ${item.platform}.` : '',
    `Composition aspect ${aspect}.`,
    style,
    'No on-image text, the caption lives below the image.',
  ].filter(Boolean).join(' ');

  const captionPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write the final social caption for "${item.title}" on ${item.platform ?? 'social'}.`,
    item.description ? `Angle/idea: ${item.description}` : '',
    item.cta ? `Mandatory CTA: ${item.cta}` : 'Add a strong CTA at the end.',
    item.hashtags?.length ? `Use hashtags (or refine): ${item.hashtags.join(' ')}` : 'Add 5-8 relevant hashtags.',
    '',
    'Output STRICT JSON: { "caption": string, "hashtags": string[], "cta": string }.',
    'The caption must respect the brand voice and structural tics above.',
  ].filter(Boolean).join('\n');

  return {
    imagePrompt,
    captionPrompt,
    aspectRatio: aspect,
    recommendedProvider: 'gemini',
  };
}

export function buildForReelIdea(input: BuilderInput): BuilderOutput {
  const { item } = input;
  const ctx = brandContextBlock(input);
  const style = visualStyleFragment(input);

  const videoScriptPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write a short-form video script (Reel/Short/TikTok, 20-35s) for "${item.title}".`,
    item.description ? `Idea: ${item.description}` : '',
    item.cta ? `CTA: ${item.cta}` : '',
    '',
    'Output STRICT JSON:',
    '{ "hook": "...", "scenes": [{ "time": "0-3s", "visual": "...", "voiceover": "..." }], "cta": "..." }',
    'Respect the brand DNA voice and the structural tics.',
  ].filter(Boolean).join('\n');

  const imagePrompt = [
    `Vertical 9:16 cover/thumbnail still for short-form video "${item.title}".`,
    item.description ? `Concept: ${item.description}` : '',
    `Eye-catching, scroll-stopping first frame.`,
    style,
    'Strong subject focal point, minimal text.',
  ].filter(Boolean).join(' ');

  const captionPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write the short social caption that accompanies the Reel "${item.title}".`,
    item.cta ? `CTA: ${item.cta}` : 'End with a strong CTA.',
    'Output STRICT JSON: { "caption": string, "hashtags": string[], "cta": string }.',
    'Keep it short — Reels captions are 1-3 lines.',
  ].filter(Boolean).join('\n');

  return {
    imagePrompt,
    videoScriptPrompt,
    captionPrompt,
    aspectRatio: '9:16',
    recommendedProvider: 'flux', // photoreal vertical thumbs perform best on FLUX
  };
}

export function buildForCarousel(input: BuilderInput): BuilderOutput {
  const { item } = input;
  const ctx = brandContextBlock(input);
  const style = visualStyleFragment(input);

  // Single canonical image prompt — the service loops & varies the slide subject.
  const imagePrompt = [
    `Instagram carousel slide for "${item.title}".`,
    item.description ? `Series concept: ${item.description}` : '',
    `Aspect 4:5. Each slide must share a consistent visual identity:`,
    style,
    'Clean editorial layout, room for an overlay caption on top or bottom third.',
    'No actual text rendered in the image — overlays will be added at design time.',
  ].filter(Boolean).join(' ');

  const captionPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write the carousel caption + the overlay text for each of 5-7 slides for "${item.title}".`,
    item.description ? `Topic: ${item.description}` : '',
    item.cta ? `Final-slide CTA: ${item.cta}` : '',
    '',
    'Output STRICT JSON:',
    '{ "caption": "main post caption", "hashtags": string[], "cta": "...",',
    '  "slides": [{ "title": "slide overlay 1", "body": "slide subtitle" }] }',
    'Provide 5-7 slides. Use the brand power words. Respect structural tics.',
  ].filter(Boolean).join('\n');

  return {
    imagePrompt,
    captionPrompt,
    aspectRatio: '4:5',
    recommendedProvider: 'flux', // FLUX = best visual consistency across a series
  };
}

export function buildForEmailIdea(input: BuilderInput): BuilderOutput {
  const { item } = input;
  const ctx = brandContextBlock(input);

  const emailObjectPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write 3 candidate subject lines for the email "${item.title}".`,
    item.description ? `Topic: ${item.description}` : '',
    '',
    'Constraints: ≤55 chars each, no clickbait, vary the angle (curiosity / value / direct).',
    'Output STRICT JSON: { "subjects": [string, string, string], "preheader": string }',
  ].filter(Boolean).join('\n');

  const emailBodyPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write the full body of the email "${item.title}".`,
    item.description ? `Brief: ${item.description}` : '',
    item.cta ? `CTA: ${item.cta}` : 'End with a clear CTA button.',
    '',
    'Structure: greeting → hook (1-2 lines) → 2-3 short value paragraphs → CTA → sign-off.',
    'Plain text (no HTML). Respect the brand DNA voice and avoided words.',
    'Output STRICT JSON: { "body": string, "ctaLabel": string, "ctaUrl": string | null }',
  ].filter(Boolean).join('\n');

  const captionPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write a 1-line internal preview/teaser for the email "${item.title}" (used in dashboards).`,
    'Output STRICT JSON: { "caption": string, "hashtags": [], "cta": string }',
  ].filter(Boolean).join('\n');

  return {
    captionPrompt,
    emailObjectPrompt,
    emailBodyPrompt,
    aspectRatio: '1:1', // optional header image
    recommendedProvider: 'claude',
  };
}

export function buildForAdIdea(input: BuilderInput): BuilderOutput {
  const { item } = input;
  const aspect = aspectRatioForItem(item);
  const ctx = brandContextBlock(input);
  const style = visualStyleFragment(input);

  const imagePrompt = [
    `Advertising visual for "${item.title}".`,
    item.description ? `Offer: ${item.description}` : '',
    `Aspect ${aspect}.`,
    style,
    'Composition must leave clear negative space for an overlaid headline + CTA button.',
    'High conversion intent, premium feel.',
  ].filter(Boolean).join(' ');

  const captionPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write 3 ad copy variants (A/B/C) for "${item.title}".`,
    item.description ? `Offer: ${item.description}` : '',
    item.cta ? `CTA: ${item.cta}` : 'CTA: "Learn more"',
    '',
    'Output STRICT JSON:',
    '{ "caption": "primary text variant A",',
    '  "hashtags": [], "cta": "...",',
    '  "variants": [{ "headline": "...", "primaryText": "...", "description": "...", "cta": "..." }] }',
    'Provide exactly 3 variants. Variant A is the recommended one (mirrored in `caption`).',
  ].filter(Boolean).join('\n');

  return {
    imagePrompt,
    captionPrompt,
    aspectRatio: aspect,
    recommendedProvider: 'dalle', // DALL-E renders text overlays the most reliably
  };
}

export function buildForCampaignIdea(input: BuilderInput): BuilderOutput {
  const { item } = input;
  const aspect = aspectRatioForItem(item);
  const ctx = brandContextBlock(input);
  const style = visualStyleFragment(input);

  const imagePrompt = [
    `Hero key-visual for marketing campaign "${item.title}".`,
    item.description ? `Theme: ${item.description}` : '',
    `Aspect ${aspect}. Iconic, memorable, ownable by the brand.`,
    style,
    'Strong central concept, suitable as a campaign signature visual.',
  ].filter(Boolean).join(' ');

  const captionPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write the launch announcement copy for campaign "${item.title}".`,
    item.description ? `Campaign idea: ${item.description}` : '',
    item.cta ? `CTA: ${item.cta}` : '',
    '',
    'Output STRICT JSON: { "caption": string, "hashtags": string[], "cta": string,',
    ' "tagline": string, "keyMessage": string }',
    'Tagline ≤ 8 words. KeyMessage = the campaign promise in one sentence.',
  ].filter(Boolean).join('\n');

  return {
    imagePrompt,
    captionPrompt,
    aspectRatio: aspect,
    recommendedProvider: 'flux',
  };
}

export function buildForContentPillar(input: BuilderInput): BuilderOutput {
  const { item } = input;
  const ctx = brandContextBlock(input);
  const style = visualStyleFragment(input);

  const imagePrompt = [
    `Symbolic illustration for editorial pillar "${item.title}".`,
    item.description ? `Pillar meaning: ${item.description}` : '',
    `Abstract / conceptual, suitable as a category cover.`,
    style,
  ].filter(Boolean).join(' ');

  const captionPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write the pillar manifesto post for "${item.title}".`,
    item.description ? `Pillar definition: ${item.description}` : '',
    '',
    'Output STRICT JSON: { "caption": string, "hashtags": string[], "cta": string,',
    ' "subPillars": [{ "title": string, "blurb": string }] }',
    'Include 3 sub-pillars (topic clusters) that ladder up to this pillar.',
  ].filter(Boolean).join('\n');

  return {
    imagePrompt,
    captionPrompt,
    aspectRatio: '1:1',
    recommendedProvider: 'gemini',
  };
}

export function buildForExperiment(input: BuilderInput): BuilderOutput {
  const { item } = input;
  const ctx = brandContextBlock(input);

  const captionPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Document the experiment "${item.title}" for the team and a teaser caption for the audience.`,
    item.description ? `Hypothesis: ${item.description}` : '',
    '',
    'Output STRICT JSON:',
    '{ "caption": "short public-facing teaser",',
    '  "hashtags": string[], "cta": "...",',
    '  "hypothesis": string, "metric": string, "successCriteria": string, "duration": string }',
  ].filter(Boolean).join('\n');

  return {
    captionPrompt,
    aspectRatio: '1:1',
    recommendedProvider: 'claude',
  };
}

export function buildForPartnership(input: BuilderInput): BuilderOutput {
  const { item } = input;
  const ctx = brandContextBlock(input);
  const style = visualStyleFragment(input);

  const imagePrompt = [
    `Co-branded announcement key-visual for partnership "${item.title}".`,
    item.description ? `Context: ${item.description}` : '',
    `Balanced layout for two logos with negative space.`,
    style,
  ].filter(Boolean).join(' ');

  const captionPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write the partnership announcement caption for "${item.title}".`,
    item.description ? `Brief: ${item.description}` : '',
    item.cta ? `CTA: ${item.cta}` : '',
    '',
    'Output STRICT JSON: { "caption": string, "hashtags": string[], "cta": string,',
    ' "partnerMention": string, "outreachDraft": string }',
    'outreachDraft = short DM/email to send to the partner to formalize.',
  ].filter(Boolean).join('\n');

  return {
    imagePrompt,
    captionPrompt,
    aspectRatio: '1:1',
    recommendedProvider: 'dalle',
  };
}

export function buildForMilestone(input: BuilderInput): BuilderOutput {
  const { item } = input;
  const ctx = brandContextBlock(input);
  const style = visualStyleFragment(input);

  const imagePrompt = [
    `Celebratory milestone visual for "${item.title}".`,
    item.description ? `Milestone: ${item.description}` : '',
    `Warm, gratitude-forward mood, room for a celebratory headline.`,
    style,
  ].filter(Boolean).join(' ');

  const captionPrompt = [
    ctx,
    '',
    `=== Task ===`,
    `Write the milestone celebration caption for "${item.title}".`,
    item.description ? `Milestone: ${item.description}` : '',
    item.cta ? `CTA: ${item.cta}` : '',
    '',
    'Output STRICT JSON: { "caption": string, "hashtags": string[], "cta": string }.',
    'Tone: grateful, community-first, no humble-brag.',
  ].filter(Boolean).join('\n');

  return {
    imagePrompt,
    captionPrompt,
    aspectRatio: '1:1',
    recommendedProvider: 'gemini',
  };
}

// =================================================================
// DISPATCH
// =================================================================

/**
 * Dispatch a StrategyItem to the right per-kind builder.
 */
export function buildPromptsForItem(input: BuilderInput): BuilderOutput {
  switch (input.item.kind) {
    case 'POST_IDEA':       return buildForPostIdea(input);
    case 'REEL_IDEA':       return buildForReelIdea(input);
    case 'EMAIL_IDEA':      return buildForEmailIdea(input);
    case 'AD_IDEA':         return buildForAdIdea(input);
    case 'CAMPAIGN_IDEA':   return buildForCampaignIdea(input);
    case 'CONTENT_PILLAR':  return buildForContentPillar(input);
    case 'EXPERIMENT':      return buildForExperiment(input);
    case 'PARTNERSHIP':     return buildForPartnership(input);
    case 'MILESTONE':       return buildForMilestone(input);
    default:                return buildForPostIdea(input);
  }
}

/**
 * Helper to detect carousel-shaped items so the service can fan-out N slides.
 */
export function isCarouselItem(item: Pick<StrategyItem, 'format' | 'kind'>): boolean {
  const format = String(item.format ?? '').toLowerCase();
  return format.includes('carousel');
}
