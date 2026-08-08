import { z } from 'zod';
import mammoth from 'mammoth';
import { handle, ok, created } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { resolveBrandContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';
import { db } from '@/lib/db';

export const maxDuration = 120;

const MAX_DOCX_BYTES = 4 * 1024 * 1024; // 4MB
const MAX_DOC_CHARS = 15000;

const schema = z.object({
  brandId: z.string(),
  horizon: z.enum(['30d', '90d', '12mo']).default('90d'),
  additionalContext: z.string().optional(),
  saveAsDraft: z.boolean().default(true),
  title: z.string().max(200).optional(),
  documents: z.array(z.object({
    filename: z.string(),
    text: z.string().optional(),
    docxBase64: z.string().optional(),
  })).max(3).optional(),
});

export const POST = handle(async (req) => {
  const body = schema.parse(await req.json());
  const { organizationId, role, brand } = await resolveBrandContext(body.brandId);
  requirePermission(role, 'campaign.manage');

  let additionalContext = body.additionalContext ?? '';
  for (const doc of body.documents ?? []) {
    let text = doc.text ?? '';
    if (doc.docxBase64) {
      const buffer = Buffer.from(doc.docxBase64, 'base64');
      if (buffer.length > MAX_DOCX_BYTES) {
        throw new AppError(`Fichier .docx trop volumineux (max 4 Mo) : ${doc.filename}`, 400, 'FILE_TOO_LARGE');
      }
      const extracted = await mammoth.extractRawText({ buffer });
      text = extracted.value;
    }
    text = text.slice(0, MAX_DOC_CHARS).trim();
    if (text) additionalContext += `\n\n=== DOCUMENT: ${doc.filename} ===\n${text}`;
  }

  const start = Date.now();
  const generated = await MarketingStrategyService.generate({
    organizationId,
    brandId: brand.id,
    horizon: body.horizon,
    additionalContext: additionalContext || undefined,
  });

  if (!body.saveAsDraft) {
    return ok({ ...generated, durationMs: Date.now() - start });
  }

  const saved = await MarketingStrategyService.save({
    organizationId,
    brandId: brand.id,
    horizon: body.horizon,
    title: body.title?.trim() || `Stratégie ${brand.name} — ${body.horizon} (${new Date().toLocaleDateString('fr-FR')})`,
    strategy: generated.strategy,
    items: generated.items,
    generatedByModel: generated.mocked ? 'mock' : 'claude',
  });

  await db.aIRequest.create({
    data: {
      organizationId,
      type: 'TEXT',
      prompt: `Marketing strategy ${body.horizon} for ${brand.name}`,
      response: `Strategy saved as ${saved.id} with ${saved.items.length} items`,
      durationMs: Date.now() - start,
      success: true,
      metadata: { provider: generated.mocked ? 'mock' : 'claude', strategyId: saved.id } as never,
    },
  });

  return created({ strategy: saved, mocked: generated.mocked, durationMs: Date.now() - start });
});
