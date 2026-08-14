import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ValidationError } from '@/lib/errors';
import { mapCsvToProspects } from '@/lib/prospect-csv';
import { ProspectingService } from '@/services/prospecting/ProspectingService';

export const dynamic = 'force-dynamic';

const schema = z.object({
  /** Contenu brut du fichier CSV (1 Mo max — largement au-delà des besoins). */
  csv: z.string().min(1).max(1_000_000),
  brandId: z.string().optional(),
  /** Provenance affichée dans la colonne source (ex. nom du fichier). */
  label: z.string().max(200).optional(),
});

/**
 * POST /api/prospects/import — importe un CSV de prospects (export Perplexity,
 * tableur…) : parsing + mapping d'en-têtes FR/EN + analyse, puis le MÊME
 * nettoyage/dédoublonnage que les recherches (email/site déjà connus =
 * doublon ignoré). Les lignes deviennent des cibles à part entière.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = schema.parse(await req.json());

  const { prospects, analysis } = mapCsvToProspects(body.csv);
  if (prospects.length === 0) {
    throw new ValidationError(
      'Aucune ligne exploitable dans ce CSV — vérifie qu’il a une ligne d’en-têtes (Organisation, Courriel, …) et au moins une ligne de données.',
    );
  }
  if (prospects.length > 500) {
    throw new ValidationError(`Import limité à 500 lignes par fichier (${prospects.length} reçues) — découpe le fichier.`);
  }

  const result = await ProspectingService.importProspects({
    organizationId: ctx.organizationId,
    brandId: body.brandId,
    rows: prospects,
    label: body.label?.trim() || 'Import CSV',
  });
  if (!result.available) throw new ValidationError(result.reason);

  return ok({
    created: result.created,
    duplicates: result.duplicates,
    analysis,
  });
});
