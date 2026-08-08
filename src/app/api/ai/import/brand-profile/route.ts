import { z } from 'zod';
import mammoth from 'mammoth';
import { handle, ok } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { resolveBrandContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { AIProviderService } from '@/services/ai/AIProviderService';

const MAX_DOCX_BYTES = 4 * 1024 * 1024; // 4MB
const MAX_TEXT_CHARS = 20000;

const schema = z
  .object({
    brandId: z.string(),
    filename: z.string(),
    text: z.string().optional(),
    docxBase64: z.string().optional(),
  })
  .refine((b) => Boolean(b.text) || Boolean(b.docxBase64), { message: 'text ou docxBase64 requis' });

export const POST = handle(async (req) => {
  const body = schema.parse(await req.json());
  const { userId, organizationId, role, brand } = await resolveBrandContext(body.brandId);
  requirePermission(role, 'ai.use');

  let text = body.text ?? '';
  if (body.docxBase64) {
    const buffer = Buffer.from(body.docxBase64, 'base64');
    if (buffer.length > MAX_DOCX_BYTES) {
      throw new AppError('Fichier .docx trop volumineux (max 4 Mo)', 400, 'FILE_TOO_LARGE');
    }
    const extracted = await mammoth.extractRawText({ buffer });
    text = extracted.value;
  }
  text = text.slice(0, MAX_TEXT_CHARS).trim();
  if (!text) {
    throw new AppError('Document vide ou illisible', 400, 'EMPTY_DOCUMENT');
  }

  const prompt = `Tu es un brand strategist. Voici le contenu d'un document de marque ("${body.filename}") pour la marque "${brand.name}".

DOCUMENT :
${text}

Extrais UNIQUEMENT les informations réellement présentes dans le document (aucune invention, aucune déduction créative). Champs possibles :
  - slogan: string
  - mission: string
  - audienceTarget: string
  - toneOfVoice: string (adjectifs séparés par virgules)
  - values: array de strings
  - productsServices: array de strings
  - wordsToUse: array de strings
  - wordsToAvoid: array de strings
  - officialHashtags: array de strings (format #exemple)
  - primaryColor: string HEX (#RRGGBB)
  - secondaryColor: string HEX (#RRGGBB)
  - accentColor: string HEX (#RRGGBB)
  - typography: string
  - visualStyle: string

Omets tout champ absent du document. Réponds UNIQUEMENT en JSON valide, sans markdown, sans texte avant/après.`;

  const result = await AIProviderService.generateText({
    prompt,
    language: 'fr',
    maxTokens: 1500,
    temperature: 0.2,
  });

  let fields: Record<string, unknown> = {};
  try {
    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) fields = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    // parse failed — fields stays empty, mocked flag tells the client
  }

  await db.aIRequest.create({
    data: {
      organizationId,
      userId,
      type: 'TEXT',
      prompt: `import brand-profile from "${body.filename}" for ${brand.name}`,
      response: JSON.stringify(fields).slice(0, 4000),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      success: true,
      metadata: { provider: result.provider, mocked: result.mocked, filename: body.filename } as never,
    },
  });

  return ok({ fields, provider: result.provider, mocked: result.mocked });
});
