import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolveBrandContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIProviderService } from '@/services/ai/AIProviderService';

const FIELDS = [
  'slogan',
  'mission',
  'audienceTarget',
  'productsServices',
  'toneOfVoice',
  'wordsToUse',
  'wordsToAvoid',
  'officialHashtags',
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'typography',
  'visualStyle',
] as const;
type Field = (typeof FIELDS)[number];

const schema = z.object({
  brandId: z.string(),
  fields: z.array(z.enum(FIELDS)).min(1),
  current: z.record(z.unknown()).optional(),
  extraContext: z.string().optional(),
});

const FIELD_PROMPTS: Record<Field, string> = {
  slogan: 'slogan court et mémorable (max 80 caractères), string',
  mission: 'mission de la marque en 2-3 phrases, string',
  audienceTarget: 'audience cible précise (démographique + psychographique), string',
  productsServices: 'liste COMPLÈTE des services et offres de la marque (ex: FabLab nomade, formations, coworking), array de strings',
  toneOfVoice: '3-5 adjectifs séparés par virgules décrivant le ton (ex: chaleureux, expert, audacieux), string',
  wordsToUse: '8-12 mots ou expressions à utiliser fréquemment, array de strings',
  wordsToAvoid: '5-8 mots à éviter, array de strings',
  officialHashtags: '5-8 hashtags officiels avec le #, array de strings',
  primaryColor: 'couleur principale en format HEX (#RRGGBB) cohérente avec l\'industrie, string',
  secondaryColor: 'couleur secondaire en format HEX (#RRGGBB), string',
  accentColor: 'couleur d\'accent en format HEX (#RRGGBB), string',
  typography: 'recommandation typographique (ex: "Montserrat pour les titres, Inter pour le corps"), string',
  visualStyle: 'style visuel en 2-4 mots (ex: minimal organique, brutaliste, éditorial), string',
};

export const POST = handle(async (req) => {
  const body = schema.parse(await req.json());
  const { userId, organizationId, role, brand } = await resolveBrandContext(body.brandId);
  requirePermission(role, 'ai.use');
  const ctx = { userId, organizationId, role };
  const profile = await db.brandProfile.findUnique({ where: { brandId: brand.id } });

  // Build rich context for the AI
  const contextLines = [
    `Marque: ${brand.name}`,
    brand.industry ? `Industrie: ${brand.industry}` : null,
    brand.description ? `Description: ${brand.description}` : null,
  ].filter(Boolean);

  // Existing profile values (from body.current or DB)
  const existing = { ...(profile ?? {}), ...(body.current ?? {}) };
  for (const f of FIELDS) {
    const v = (existing as Record<string, unknown>)[f];
    if (v && (typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.length : true)) {
      const display = Array.isArray(v) ? v.join(', ') : String(v);
      contextLines.push(`${f} actuel: ${display}`);
    }
  }
  if (body.extraContext) contextLines.push(`Contexte additionnel: ${body.extraContext}`);

  const requestedFields = body.fields.map((f) => `  - ${f}: ${FIELD_PROMPTS[f]}`).join('\n');

  const prompt = `Tu es un brand strategist. À partir de ce contexte de marque, génère des suggestions COHÉRENTES pour les champs demandés.

CONTEXTE :
${contextLines.join('\n')}

CHAMPS À REMPLIR :
${requestedFields}

Règles :
- Garde une cohérence stricte avec les valeurs existantes (ne contredis pas la marque)
- Pour les couleurs HEX, choisis une palette qui fonctionne ensemble si plusieurs demandées
- Pour les hashtags, mélange un de marque (#${brand.slug.replace(/-/g, '')}) avec des hashtags d'industrie
- Pour les mots à utiliser / éviter : pertinents pour le secteur

Réponds UNIQUEMENT en JSON valide avec exactement les champs demandés. Pas de markdown, pas de texte avant/après.

Exemple format :
{
  "slogan": "...",
  "officialHashtags": ["#foo", "#bar"]
}`;

  const result = await AIProviderService.generateText({
    prompt,
    language: 'fr',
    maxTokens: 1500,
    temperature: 0.8,
  });

  // Parse JSON
  let suggestions: Partial<Record<Field, unknown>> = {};
  try {
    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) {
      suggestions = JSON.parse(match[0]) as Partial<Record<Field, unknown>>;
    }
  } catch (err) {
    // Fall back: if mocked, return mock suggestions
    if (result.mocked) {
      suggestions = mockSuggestions(brand.name, brand.industry ?? null, body.fields);
    }
  }

  // If mock and parse failed, ensure we still return useful data
  if (result.mocked && Object.keys(suggestions).length === 0) {
    suggestions = mockSuggestions(brand.name, brand.industry ?? null, body.fields);
  }

  // Log to AIRequest for cost tracking
  await db.aIRequest.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      type: 'TEXT',
      prompt: `enrich brand-profile [${body.fields.join(', ')}] for ${brand.name}`,
      response: JSON.stringify(suggestions).slice(0, 4000),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      success: true,
      metadata: { provider: result.provider, mocked: result.mocked, fields: body.fields } as never,
    },
  });

  return ok({
    suggestions,
    provider: result.provider,
    mocked: result.mocked,
  });
});

function mockSuggestions(brandName: string, industry: string | null, fields: Field[]): Partial<Record<Field, unknown>> {
  const ind = industry?.toLowerCase() ?? '';
  const mock: Partial<Record<Field, unknown>> = {
    slogan: `[MOCK] ${brandName} — votre solution ${industry ? `pour ${industry.toLowerCase()}` : 'unique'}`,
    mission: `[MOCK] Chez ${brandName}, nous transformons la manière dont nos clients vivent leur expérience${industry ? ` dans le secteur ${industry.toLowerCase()}` : ''}. Notre engagement : qualité, authenticité, et impact mesurable.`,
    audienceTarget: ind.includes('eyewear') || ind.includes('lunette') ? 'Adultes 25-50 ans urbains, sensibles au design, aux nouvelles technologies et à la personnalisation' : 'Professionnels engagés 25-45 ans, cherchant authenticité et excellence',
    toneOfVoice: 'inspirant, expert, accessible',
    wordsToUse: ['authentique', 'qualité', 'innovation', 'communauté', 'durable', 'créatif', 'expert', 'sur-mesure'],
    wordsToAvoid: ['cheap', 'urgent', 'gratuit', 'incroyable', 'révolutionnaire'],
    officialHashtags: [`#${brandName.toLowerCase().replace(/\s+/g, '')}`, '#design', '#innovation', '#3dprinting', '#madeineurope'],
    primaryColor: '#3d62f5',
    secondaryColor: '#1a2e8c',
    accentColor: '#ff6b6b',
    typography: 'Montserrat pour les titres, Inter pour le corps',
    visualStyle: 'minimal, futuriste, éditorial',
  };
  const out: Partial<Record<Field, unknown>> = {};
  for (const f of fields) out[f] = mock[f];
  return out;
}
