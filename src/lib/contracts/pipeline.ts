import { z } from 'zod';

/**
 * Contrats partagés du pipeline « 5 Actes » — importés à la fois par les
 * routes API (`schema.parse(await req.json())`) et par les composants client
 * (`schema.parse(payload)` avant `fetch`). Source unique de vérité : une clé
 * ne peut plus diverger entre le front et le back sans casser le typage/les
 * tests. Ne JAMAIS importer de modules serveur ici (db, tenant…) — ce fichier
 * doit rester exécutable côté navigateur.
 */

export const PIPELINE_HORIZONS = ['30d', '90d', '12mo'] as const;
export type PipelineHorizon = (typeof PIPELINE_HORIZONS)[number];

export const brandSeedInput = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  description: z.string().optional(),
  website: z.string().optional(),
  audienceHint: z.string().optional(),
});
export type BrandSeedInput = z.infer<typeof brandSeedInput>;

export const createPipelineInput = z.object({
  brandSeed: brandSeedInput,
  horizon: z.enum(PIPELINE_HORIZONS).default('90d'),
  language: z.string().default('fr'),
  autoMode: z.boolean().default(false),
  // Marque existante à développer (enchaînement « créer une marque →
  // stratégie IA ») — sans lui, le pipeline crée une nouvelle marque.
  brandId: z.string().optional(),
});
export type CreatePipelineInput = z.infer<typeof createPipelineInput>;

export const PIPELINE_ADMIN_STEPS = ['VALIDATE_PROFILE', 'VALIDATE_STRATEGY_ITEMS'] as const;
export type PipelineAdminStep = (typeof PIPELINE_ADMIN_STEPS)[number];

export const approveStepInput = z.object({
  stepName: z.enum(PIPELINE_ADMIN_STEPS).optional(),
});
export type ApproveStepInput = z.infer<typeof approveStepInput>;
