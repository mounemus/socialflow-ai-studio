import { z } from 'zod';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { handle, ok, created } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { resolveBrandContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';
import { db } from '@/lib/db';

export const maxDuration = 120;

const MAX_DOCX_BYTES = 4 * 1024 * 1024; // 4MB
// ponytail: 3MB par PDF — la requête entière doit rester sous la limite body
// Vercel (4,5 MB), base64 inclus. Passer par le storage si besoin de plus gros.
const MAX_PDF_BYTES = 3 * 1024 * 1024;
// ~15k tokens par document — assez pour un plan marketing de 30 pages.
const MAX_DOC_CHARS = 60000;

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
    pdfBase64: z.string().optional(),
  })).max(3).optional(),
});

export const POST = handle(async (req) => {
  const body = schema.parse(await req.json());
  const { organizationId, role, brand } = await resolveBrandContext(body.brandId);
  requirePermission(role, 'campaign.manage');

  let documentsContext = '';
  for (const doc of body.documents ?? []) {
    let text = doc.text ?? '';
    if (doc.docxBase64) {
      const buffer = Buffer.from(doc.docxBase64, 'base64');
      if (buffer.length > MAX_DOCX_BYTES) {
        throw new AppError(`Fichier .docx trop volumineux (max 4 Mo) : ${doc.filename}`, 400, 'FILE_TOO_LARGE');
      }
      const extracted = await mammoth.extractRawText({ buffer });
      text = extracted.value;
    } else if (doc.pdfBase64) {
      const buffer = Buffer.from(doc.pdfBase64, 'base64');
      if (buffer.length > MAX_PDF_BYTES) {
        throw new AppError(`Fichier .pdf trop volumineux (max 3 Mo) : ${doc.filename}`, 400, 'FILE_TOO_LARGE');
      }
      const extracted = await extractText(new Uint8Array(buffer), { mergePages: true });
      text = extracted.text;
      if (!text.trim()) {
        throw new AppError(
          `Aucun texte extractible dans « ${doc.filename} » (PDF scanné/image ?). Convertis-le en texte ou colle le contenu dans le champ contexte.`,
          400,
          'PDF_NO_TEXT',
        );
      }
    }
    const truncated = text.length > MAX_DOC_CHARS;
    text = text.slice(0, MAX_DOC_CHARS).trim();
    if (text) {
      documentsContext += `\n\n=== DOCUMENT: ${doc.filename} ===\n${text}`;
      if (truncated) documentsContext += '\n[… document tronqué …]';
    }
  }

  let additionalContext = body.additionalContext ?? '';
  if (documentsContext) {
    additionalContext +=
      "\n\nIMPORTANT : les documents ci-dessous sont la RÉFÉRENCE PRINCIPALE fournie par l'utilisateur. " +
      'Base la stratégie prioritairement sur leur contenu (objectifs, cibles, offres, budget, calendrier) — ' +
      'le profil de marque ne sert que de complément.' +
      documentsContext;
  }

  const start = Date.now();
  const generated = await MarketingStrategyService.generate({
    organizationId,
    brandId: brand.id,
    horizon: body.horizon,
    additionalContext: additionalContext || undefined,
  });

  // Vérité opérationnelle : on n'enregistre JAMAIS une stratégie simulée comme
  // livrable — avant, le gabarit mock (mêmes 10 items pour toutes les marques)
  // était sauvegardé sans avertissement clair.
  if (generated.mocked) {
    throw new AppError(
      generated.mockReason === 'parse_failed'
        ? "L'IA a répondu mais le résultat était inexploitable — réessaie (rien n'a été enregistré)."
        : "Aucun modèle IA disponible — vérifie les clés dans Paramètres → Modèles IA (rien n'a été enregistré).",
      502,
      'AI_GENERATION_FAILED',
    );
  }

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
    generatedByModel: 'claude',
  });

  await db.aIRequest.create({
    data: {
      organizationId,
      type: 'TEXT',
      prompt: `Marketing strategy ${body.horizon} for ${brand.name}`,
      response: `Strategy saved as ${saved.id} with ${saved.items.length} items`,
      durationMs: Date.now() - start,
      success: true,
      metadata: { provider: 'claude', strategyId: saved.id } as never,
    },
  });

  return created({ strategy: saved, mocked: false, durationMs: Date.now() - start });
});
