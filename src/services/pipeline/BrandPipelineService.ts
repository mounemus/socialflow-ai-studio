/**
 * BrandPipelineService — core state-machine orchestrator for the brand
 * onboarding pipeline.
 *
 * Drives: create brand -> AI enrich profile -> validate fields ->
 * generate strategy -> validate items -> auto-schedule -> calendar.
 *
 * State machine (persisted on BrandPipelineRun.step):
 *   CREATE_BRAND               ->  ENRICH_PROFILE          (auto)
 *   ENRICH_PROFILE             ->  VALIDATE_PROFILE        (auto, after fan-out)
 *   VALIDATE_PROFILE           ->  GENERATE_STRATEGY       (admin gate)
 *   GENERATE_STRATEGY          ->  VALIDATE_STRATEGY_ITEMS (auto)
 *   VALIDATE_STRATEGY_ITEMS    ->  EXECUTE_ITEMS           (admin gate)
 *   EXECUTE_ITEMS              ->  DONE                    (auto, loops items)
 *
 * Public methods always return { success, ... } — they never throw.
 *
 * Re-uses existing services:
 *   - AIProviderService for per-field enrichment (same prompt scheme as
 *     /api/ai/enrich/brand-profile)
 *   - MarketingStrategyService for strategy generation, item regeneration,
 *     and item execution (Post + auto-schedule + Campaign creation)
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { AIProviderService } from '@/services/ai/AIProviderService';
import { AIRouterService } from '@/services/ai/AIRouterService';
import { MarketingStrategyService } from '@/services/strategy/MarketingStrategyService';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';
import type {
  BrandPipelineRun,
  BrandPipelineStatus,
  BrandPipelineStep,
  SocialPlatform,
} from '@prisma/client';

// ============================================================================
// CONSTANTS — the 11 enrichable BrandProfile fields
// ============================================================================
export const BRAND_PROFILE_FIELDS = [
  'slogan',
  'mission',
  'audienceTarget',
  'toneOfVoice',
  'wordsToUse',
  'wordsToAvoid',
  'officialHashtags',
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'visualStyle',
] as const;

export type BrandProfileField = (typeof BRAND_PROFILE_FIELDS)[number];

const FIELD_PROMPTS: Record<BrandProfileField, string> = {
  slogan: 'slogan court et mémorable (max 80 caractères), string',
  mission: 'mission de la marque en 2-3 phrases, string',
  audienceTarget: 'audience cible précise (démographique + psychographique), string',
  toneOfVoice: '3-5 adjectifs séparés par virgules décrivant le ton, string',
  wordsToUse: '8-12 mots ou expressions à utiliser fréquemment, array de strings',
  wordsToAvoid: '5-8 mots à éviter, array de strings',
  officialHashtags: '5-8 hashtags officiels avec le #, array de strings',
  primaryColor: 'couleur principale en format HEX (#RRGGBB), string',
  secondaryColor: 'couleur secondaire en format HEX (#RRGGBB), string',
  accentColor: 'couleur d\'accent en format HEX (#RRGGBB), string',
  visualStyle: 'style visuel en 2-4 mots (ex: minimal organique, éditorial), string',
};

// ============================================================================
// TYPES
// ============================================================================
export type FieldStatus = 'PENDING' | 'PROPOSED' | 'EDITED' | 'APPROVED' | 'REJECTED';
export type ItemStatus = 'PROPOSED' | 'EDITED' | 'APPROVED' | 'REJECTED' | 'EXECUTED';

export interface FieldState {
  status: FieldStatus;
  value: unknown;
  history: Array<{ at: string; by: string; value: unknown; source: 'ai' | 'user' | 'profile' }>;
  rejectedReason?: string;
}

export interface ItemState {
  status: ItemStatus;
  rejectedReason?: string;
  warnings?: string[];
  postId?: string;
  campaignId?: string;
  scheduleId?: string;
}

export interface PipelineEvent {
  kind:
    | 'STEP_ENTER'
    | 'STEP_EXIT'
    | 'FIELD_PROPOSED'
    | 'FIELD_EDIT'
    | 'FIELD_APPROVED'
    | 'FIELD_REJECTED'
    | 'PROFILE_APPROVED'
    | 'STRATEGY_GENERATED'
    | 'ITEM_APPROVED'
    | 'ITEM_REJECTED'
    | 'ITEM_EXECUTED'
    | 'PIPELINE_DONE'
    | 'PIPELINE_FAILED'
    | 'PIPELINE_CANCELLED'
    | 'ERROR';
  at: string;
  payload: Record<string, unknown>;
}

export interface PipelineSeed {
  name: string;
  industry?: string;
  description?: string;
  website?: string;
  audienceHint?: string;
  clientId?: string;
  /** Stratégie existante choisie au lancement — adoptée telle quelle à l'Acte 3. */
  strategyId?: string;
  /** Force une génération neuve à l'Acte 3 (aucune réutilisation). */
  forceNewStrategy?: boolean;
}

export interface CreatePipelineOpts {
  organizationId: string;
  userId: string;
  brandSeed: PipelineSeed;
  horizon?: '30d' | '90d' | '12mo';
  language?: string;
  autoMode?: boolean;
  adminNotes?: string;
  /**
   * Marque EXISTANTE à développer. Sans lui, l'étape CREATE_BRAND crée une
   * nouvelle marque (slug suffixé en cas d'homonyme) — c'est ce qui dupliquait
   * les marques quand on enchaînait « créer une marque » puis « pipeline ».
   */
  brandId?: string;
}

export interface PipelineResult<T = unknown> {
  success: boolean;
  reason?: string;
  data?: T;
}

export interface PipelineClientView {
  id: string;
  organizationId: string;
  brandId: string | null;
  strategyId: string | null;
  status: BrandPipelineStatus;
  step: BrandPipelineStep;
  horizon: string;
  language: string;
  autoMode: boolean;
  seed: PipelineSeed;
  awaitingAdmin: boolean;
  approvedProfileAt: Date | null;
  approvedStrategyAt: Date | null;
  completedAt: Date | null;
  failureReason: string | null;
  fields: Array<{
    name: BrandProfileField;
    status: FieldStatus;
    value: unknown;
    rejectedReason?: string;
    historyLen: number;
  }>;
  fieldsSummary: {
    total: number;
    pending: number;
    proposed: number;
    approved: number;
    rejected: number;
  };
  items: Array<{
    id: string;
    status: ItemStatus;
    rejectedReason?: string;
    warnings?: string[];
  }>;
  itemsSummary: { total: number; approved: number; rejected: number; executed: number };
  executionLog: Array<Record<string, unknown>>;
  recentTrace: PipelineEvent[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// HELPERS
// ============================================================================
function emptyFieldState(): FieldState {
  return { status: 'PENDING', value: null, history: [] };
}

function buildSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 50) || 'brand'
  );
}

async function uniqueBrandSlug(organizationId: string, baseName: string): Promise<string> {
  const base = buildSlug(baseName);
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await db.brand.findFirst({
      where: { organizationId, slug },
      select: { id: true },
    });
    if (!existing) return slug;
    n += 1;
    slug = `${base}-${n}`;
    if (n > 50) return `${base}-${Date.now()}`;
  }
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readFieldStates(run: BrandPipelineRun): Record<string, FieldState> {
  return ((run.fieldStates as unknown) as Record<string, FieldState>) ?? {};
}

function readItemStates(run: BrandPipelineRun): Record<string, ItemState> {
  return ((run.itemStates as unknown) as Record<string, ItemState>) ?? {};
}

function readTrace(run: BrandPipelineRun): PipelineEvent[] {
  return ((run.trace as unknown) as PipelineEvent[]) ?? [];
}

function readExecutionLog(run: BrandPipelineRun): Array<Record<string, unknown>> {
  return ((run.executionLog as unknown) as Array<Record<string, unknown>>) ?? [];
}

function readSeed(run: BrandPipelineRun): PipelineSeed & { _autoMode?: boolean } {
  return ((run.seed as unknown) as PipelineSeed & { _autoMode?: boolean }) ?? { name: '' };
}

// ============================================================================
// SERVICE
// ============================================================================
export const BrandPipelineService = {
  // -------------------- LIFECYCLE --------------------

  /**
   * Create a new pipeline run. Immediately executes step 1 (CREATE_BRAND)
   * which creates the Brand + empty BrandProfile and primes fieldStates.
   * If autoMode is true (default), also kicks off ENRICH_PROFILE before returning.
   */
  async createPipeline(
    opts: CreatePipelineOpts,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const horizon = opts.horizon ?? '90d';
      const language = opts.language ?? 'fr';
      const autoMode = opts.autoMode ?? true;

      // Anti-doublon : un pipeline actif existe déjà pour cette marque (même
      // nom, même org) → on le RÉUTILISE au lieu d'en créer un deuxième.
      const existing = await db.brandPipelineRun.findFirst({
        where: {
          organizationId: opts.organizationId,
          status: { in: ['RUNNING', 'AWAITING_ADMIN', 'PAUSED'] },
          OR: [
            { seed: { path: ['name'], equals: opts.brandSeed.name } },
            { brand: { name: opts.brandSeed.name } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        logger.info('BrandPipeline.createPipeline: run actif existant réutilisé', {
          runId: existing.id,
          name: opts.brandSeed.name,
        });
        return { success: true, data: { run: existing } };
      }

      // Marque existante fournie : on la valide et on l'attache au run —
      // CREATE_BRAND la réutilisera au lieu d'en créer une deuxième.
      let attachedBrandId: string | null = null;
      if (opts.brandId) {
        const brand = await db.brand.findFirst({
          where: { id: opts.brandId, organizationId: opts.organizationId },
          select: { id: true },
        });
        if (!brand) return { success: false, reason: 'Marque introuvable dans cette organisation' };
        attachedBrandId = brand.id;
        // Garantit le BrandProfile attendu par ENRICH_PROFILE.
        await db.brandProfile.upsert({
          where: { brandId: brand.id },
          create: { brandId: brand.id },
          update: {},
        });
      }

      // Initialise empty per-field state for the 11 enrichable fields.
      const fieldStates: Record<string, FieldState> = {};
      for (const f of BRAND_PROFILE_FIELDS) fieldStates[f] = emptyFieldState();

      const seed: PipelineSeed & { _autoMode?: boolean } = {
        name: opts.brandSeed.name,
        industry: opts.brandSeed.industry,
        description: opts.brandSeed.description,
        website: opts.brandSeed.website,
        audienceHint: opts.brandSeed.audienceHint,
        clientId: opts.brandSeed.clientId,
        _autoMode: autoMode,
      };

      const run = await db.brandPipelineRun.create({
        data: {
          organizationId: opts.organizationId,
          startedById: opts.userId,
          brandId: attachedBrandId,
          horizon,
          language,
          status: 'RUNNING',
          step: 'CREATE_BRAND',
          seed: seed as never,
          fieldStates: fieldStates as never,
          itemStates: {} as never,
          executionLog: [] as never,
          trace: [
            {
              kind: 'STEP_ENTER',
              at: new Date().toISOString(),
              payload: { step: 'CREATE_BRAND', autoMode },
            },
          ] as never,
          adminNotes: opts.adminNotes,
        },
      });

      logger.info('BrandPipeline.created', {
        runId: run.id,
        organizationId: opts.organizationId,
        autoMode,
      });

      // Step 1: create the Brand + empty profile right away.
      const createRes = await this._performCreateBrand(run.id);
      if (!createRes.success) {
        return { success: false, reason: createRes.reason };
      }

      // If autoMode, advance into ENRICH_PROFILE so the caller already has proposals.
      if (autoMode) {
        await this.advanceStep(run.id);
      }

      const fresh = await db.brandPipelineRun.findUnique({ where: { id: run.id } });
      return { success: true, data: { run: fresh ?? run } };
    } catch (err) {
      logger.error('BrandPipeline.createPipeline failed', {
        err: (err as Error).message,
      });
      return { success: false, reason: (err as Error).message };
    }
  },

  /** Fetch a single run (raw row). */
  async getPipeline(id: string): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      return { success: true, data: { run } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /** List runs for an organization, most recent first. */
  async listForOrg(
    organizationId: string,
    opts?: { take?: number; status?: BrandPipelineStatus },
  ): Promise<PipelineResult<{ runs: BrandPipelineRun[] }>> {
    try {
      const runs = await db.brandPipelineRun.findMany({
        where: {
          organizationId,
          ...(opts?.status ? { status: opts.status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: opts?.take ?? 50,
      });
      return { success: true, data: { runs } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /**
   * Advance the state machine by one step. Idempotent — if the current step
   * is already complete, transitions to the next one. If the step is an
   * admin gate, returns awaiting:'admin' without progressing further.
   */
  async advanceStep(
    pipelineId: string,
  ): Promise<
    PipelineResult<{ run: BrandPipelineRun; awaiting: 'admin' | null; nextStep: BrandPipelineStep }>
  > {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (
        run.status === 'COMPLETED' ||
        run.status === 'CANCELLED' ||
        run.status === 'FAILED'
      ) {
        return {
          success: true,
          data: { run, awaiting: null, nextStep: run.step },
        };
      }

      logger.info('BrandPipeline.advanceStep', {
        runId: pipelineId,
        step: run.step,
        status: run.status,
      });

      switch (run.step) {
        case 'CREATE_BRAND': {
          if (!run.brandId) {
            const r = await this._performCreateBrand(run.id);
            if (!r.success) {
              return { success: false, reason: r.reason };
            }
          }
          await this._transition(run.id, 'ENRICH_PROFILE');
          return this.advanceStep(run.id);
        }

        case 'ENRICH_PROFILE': {
          // Verrou : deux /advance concurrents (double onglet, F5 pendant une
          // étape longue) exécutaient le travail DEUX fois — enrichissement,
          // stratégie et exécution facturés/planifiés en double.
          if (!(await this._claimRun(run.id, 'ENRICH_PROFILE'))) {
            return { success: true, data: { run, awaiting: null, nextStep: run.step } };
          }
          try {
          const r = await this._performEnrichProfile(run.id);
          if (!r.success) {
            return { success: false, reason: r.reason };
          }
          await this._transition(run.id, 'VALIDATE_PROFILE');
          await db.brandPipelineRun.update({
            where: { id: run.id },
            data: { status: 'AWAITING_ADMIN' },
          });
          const fresh = await db.brandPipelineRun.findUnique({ where: { id: run.id } });
          return {
            success: true,
            data: { run: fresh!, awaiting: 'admin', nextStep: 'VALIDATE_PROFILE' },
          };
          } finally {
            await this._releaseRun(run.id);
          }
        }

        case 'VALIDATE_PROFILE': {
          return {
            success: true,
            data: { run, awaiting: 'admin', nextStep: 'VALIDATE_PROFILE' },
          };
        }

        case 'GENERATE_STRATEGY': {
          if (!(await this._claimRun(run.id, 'GENERATE_STRATEGY'))) {
            return { success: true, data: { run, awaiting: null, nextStep: run.step } };
          }
          try {
          const r = await this._performGenerateStrategy(run.id);
          if (!r.success) {
            return { success: false, reason: r.reason };
          }
          await this._transition(run.id, 'VALIDATE_STRATEGY_ITEMS');
          await db.brandPipelineRun.update({
            where: { id: run.id },
            data: { status: 'AWAITING_ADMIN' },
          });
          const fresh = await db.brandPipelineRun.findUnique({ where: { id: run.id } });
          return {
            success: true,
            data: { run: fresh!, awaiting: 'admin', nextStep: 'VALIDATE_STRATEGY_ITEMS' },
          };
          } finally {
            await this._releaseRun(run.id);
          }
        }

        case 'VALIDATE_STRATEGY_ITEMS': {
          // Auto-advance to EXECUTE_ITEMS when every approved item is also
          // marked concretization-ready in metadata.concretization.status.
          const states = readItemStates(run);
          const approvedIds = Object.entries(states)
            .filter(([, s]) => s.status === 'APPROVED' || s.status === 'EDITED')
            .map(([id]) => id);

          if (approvedIds.length > 0 && run.strategyId) {
            const items = await db.strategyItem.findMany({
              where: { id: { in: approvedIds }, strategyId: run.strategyId },
              select: { id: true, metadata: true },
            });
            const allReady =
              items.length === approvedIds.length &&
              items.every((it) => {
                const meta = (it.metadata ?? {}) as Record<string, unknown>;
                const conc = (meta.concretization ?? {}) as Record<string, unknown>;
                return conc.status === 'ready';
              });
            if (allReady) {
              await db.brandPipelineRun.update({
                where: { id: run.id },
                data: { step: 'EXECUTE_ITEMS', status: 'RUNNING' },
              });
              await this._appendTrace(run.id, {
                kind: 'STEP_ENTER',
                at: new Date().toISOString(),
                payload: { step: 'EXECUTE_ITEMS', auto: 'concretization-ready' },
              });
              const fresh = await db.brandPipelineRun.findUnique({ where: { id: run.id } });
              return {
                success: true,
                data: { run: fresh!, awaiting: null, nextStep: 'EXECUTE_ITEMS' },
              };
            }
          }

          return {
            success: true,
            data: { run, awaiting: 'admin', nextStep: 'VALIDATE_STRATEGY_ITEMS' },
          };
        }

        case 'EXECUTE_ITEMS': {
          if (!(await this._claimRun(run.id, 'EXECUTE_ITEMS'))) {
            return { success: true, data: { run, awaiting: null, nextStep: run.step } };
          }
          try {
          const r = await this._performExecuteItems(run.id);
          if (!r.success) {
            return { success: false, reason: r.reason };
          }
          await this._transition(run.id, 'DONE');
          await db.brandPipelineRun.update({
            where: { id: run.id },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });
          await this._appendTrace(run.id, {
            kind: 'PIPELINE_DONE',
            at: new Date().toISOString(),
            payload: {},
          });
          const fresh = await db.brandPipelineRun.findUnique({ where: { id: run.id } });
          return {
            success: true,
            data: { run: fresh!, awaiting: null, nextStep: 'DONE' },
          };
          } finally {
            await this._releaseRun(run.id);
          }
        }

        case 'DONE': {
          return { success: true, data: { run, awaiting: null, nextStep: 'DONE' } };
        }

        default:
          return { success: false, reason: `Unknown step ${run.step}` };
      }
    } catch (err) {
      logger.error('BrandPipeline.advanceStep failed', {
        pipelineId,
        err: (err as Error).message,
      });
      await this.fail(pipelineId, (err as Error).message).catch(() => undefined);
      return { success: false, reason: (err as Error).message };
    }
  },

  /**
   * Approve the admin gate for the current step.
   *   - VALIDATE_PROFILE: requires every field APPROVED or EDITED. Persists
   *     final BrandProfile values + records approvedProfileAt.
   *   - VALIDATE_STRATEGY_ITEMS: requires >=1 APPROVED/EDITED item. Flips
   *     MarketingStrategy.status to VALIDATED.
   * If autoMode is true on the run, immediately advances to the next step.
   */
  async approveStep(
    pipelineId: string,
    stepName: BrandPipelineStep,
    adminUserId: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun; advanced: boolean }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (run.step !== stepName) {
        return {
          success: false,
          reason: `Cannot approve ${stepName} — current step is ${run.step}`,
        };
      }

      if (stepName === 'VALIDATE_PROFILE') {
        const fieldStates = readFieldStates(run);
        const unapproved = BRAND_PROFILE_FIELDS.filter((f) => {
          const s = fieldStates[f];
          return !s || (s.status !== 'APPROVED' && s.status !== 'EDITED');
        });
        if (unapproved.length > 0) {
          return {
            success: false,
            reason: `Cannot approve profile — fields not approved: ${unapproved.join(', ')}`,
          };
        }
        const persisted = await this._persistApprovedProfileToDb(run.id);
        if (!persisted.success) {
          return { success: false, reason: persisted.reason };
        }
        await db.brandPipelineRun.update({
          where: { id: run.id },
          data: {
            approvedProfileAt: new Date(),
            approvedProfileById: adminUserId,
            status: 'RUNNING',
            step: 'GENERATE_STRATEGY',
          },
        });
        await this._appendTrace(run.id, {
          kind: 'PROFILE_APPROVED',
          at: new Date().toISOString(),
          payload: { by: adminUserId },
        });
      } else if (stepName === 'VALIDATE_STRATEGY_ITEMS') {
        const itemStates = readItemStates(run);
        const approvedItems = Object.entries(itemStates).filter(
          ([, s]) => s.status === 'APPROVED' || s.status === 'EDITED',
        );
        if (approvedItems.length === 0) {
          return {
            success: false,
            reason: 'Cannot approve strategy — at least 1 item must be approved',
          };
        }
        if (run.strategyId) {
          await db.marketingStrategy.update({
            where: { id: run.strategyId },
            data: {
              status: 'VALIDATED',
              validatedAt: new Date(),
              validatedById: adminUserId,
            },
          });
        }
        await db.brandPipelineRun.update({
          where: { id: run.id },
          data: {
            approvedStrategyAt: new Date(),
            approvedStrategyById: adminUserId,
            status: 'RUNNING',
            step: 'EXECUTE_ITEMS',
          },
        });
        await this._appendTrace(run.id, {
          kind: 'STRATEGY_GENERATED',
          at: new Date().toISOString(),
          payload: {
            strategyId: run.strategyId,
            approved: approvedItems.length,
          },
        });
      } else {
        return { success: false, reason: `Step ${stepName} is not an admin gate` };
      }

      const seed = readSeed(run);
      const autoMode = seed._autoMode !== false;

      let advanced = false;
      if (autoMode) {
        const adv = await this.advanceStep(pipelineId);
        if (adv.success) advanced = true;
      }

      const fresh = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      logger.info('BrandPipeline.approveStep', {
        pipelineId,
        stepName,
        advanced,
        nextStep: fresh?.step,
      });
      return { success: true, data: { run: fresh!, advanced } };
    } catch (err) {
      logger.error('BrandPipeline.approveStep failed', {
        pipelineId,
        stepName,
        err: (err as Error).message,
      });
      return { success: false, reason: (err as Error).message };
    }
  },

  /**
   * Reject the current admin gate step with feedback.
   *
   * Legacy-compatible signature: `rejectStep(id, stepName, feedback, userId)`.
   * Throws on missing pipeline; returns `{ step, status, feedback }`.
   *
   * For the new result-shaped API, use `rejectCurrentStep` instead.
   */
  async rejectStep(
    pipelineId: string,
    stepName: BrandPipelineStep | string,
    feedback: string,
    legacyUserId?: string,
  ): Promise<{ step: BrandPipelineStep; status: BrandPipelineStatus; feedback: string }> {
    // === LEGACY PATH (4 args + throwing semantics) ===
    if (legacyUserId !== undefined) {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) throw new Error('Pipeline not found');

      const trace = readTrace(run);
      const noteLine = `[${new Date().toISOString()}] reject(${stepName}) by ${legacyUserId}: ${feedback}`;
      const adminNotes = run.adminNotes ? `${run.adminNotes}\n${noteLine}` : noteLine;

      trace.push({
        kind: 'FIELD_REJECTED',
        at: new Date().toISOString(),
        payload: { stepName, by: legacyUserId, feedback, action: 'reject' },
      });
      // Also push a legacy-shape entry so existing tests can find action === 'reject'
      const legacyTrace = (trace as unknown as Array<Record<string, unknown>>);
      legacyTrace.push({
        ts: new Date().toISOString(),
        actor: 'user',
        step: stepName,
        action: 'reject',
        by: legacyUserId,
        detail: { feedback },
      });

      const updated = await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: {
          status: 'AWAITING_ADMIN',
          adminNotes,
          trace: legacyTrace as never,
        },
      });
      return { step: updated.step, status: updated.status, feedback };
    }

    // === NEW PATH (3 args) ===
    // Drive the full state-machine reject and project back to the legacy shape.
    const res = await this._rejectStepNew(pipelineId, stepName as BrandPipelineStep, feedback);
    if (!res.success || !res.data) {
      throw new Error(res.reason ?? 'rejectStep failed');
    }
    return {
      step: res.data.run.step,
      status: res.data.run.status,
      feedback,
    };
  },

  /**
   * New result-shaped reject API. Same semantics as `rejectStep` but never throws.
   */
  async rejectCurrentStep(
    pipelineId: string,
    stepName: BrandPipelineStep,
    feedback: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    return this._rejectStepNew(pipelineId, stepName, feedback);
  },

  /** Internal new-mode reject implementation (full state-machine driven). */
  async _rejectStepNew(
    pipelineId: string,
    stepName: BrandPipelineStep,
    feedback: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (run.step !== stepName) {
        return {
          success: false,
          reason: `Cannot reject ${stepName} — current step is ${run.step}`,
        };
      }

      const adminNotes = [run.adminNotes, `[${new Date().toISOString()}] ${feedback}`]
        .filter(Boolean)
        .join('\n');

      if (stepName === 'VALIDATE_PROFILE') {
        const fieldStates = readFieldStates(run);
        for (const f of BRAND_PROFILE_FIELDS) {
          fieldStates[f] = {
            ...(fieldStates[f] ?? emptyFieldState()),
            status: 'PENDING',
            rejectedReason: feedback,
          };
        }
        await db.brandPipelineRun.update({
          where: { id: run.id },
          data: {
            fieldStates: fieldStates as never,
            adminNotes,
            status: 'RUNNING',
            step: 'ENRICH_PROFILE',
          },
        });
        await this._appendTrace(run.id, {
          kind: 'FIELD_REJECTED',
          at: new Date().toISOString(),
          payload: { feedback, scope: 'all' },
        });
        await this.advanceStep(pipelineId);
      } else if (stepName === 'VALIDATE_STRATEGY_ITEMS') {
        if (run.strategyId) {
          // Rejeter = repartir PROPRE : le travail généré (posts non publiés,
          // concrétisations) est nettoyé — sinon il restait orphelin et ses
          // créneaux continuaient d'être publiés par le cron.
          await this._purgeStrategyGeneratedWork(run.strategyId, run.organizationId).catch((err) =>
            logger.warn('rejectStep: purge du travail généré échouée', {
              pipelineId,
              err: (err as Error).message,
            }),
          );
          // Archiver (pas supprimer) : la stratégie peut avoir été créée par
          // l'utilisateur (ex. depuis un PDF) puis adoptée par le run. L'archivage
          // la sort du circuit de réutilisation → la régénération repart de zéro.
          await db.marketingStrategy
            .update({ where: { id: run.strategyId }, data: { status: 'ARCHIVED' } })
            .catch(() => undefined);
        }
        await db.brandPipelineRun.update({
          where: { id: run.id },
          data: {
            strategyId: null,
            itemStates: {} as never,
            adminNotes,
            status: 'RUNNING',
            step: 'GENERATE_STRATEGY',
          },
        });
        await this._appendTrace(run.id, {
          kind: 'ITEM_REJECTED',
          at: new Date().toISOString(),
          payload: { feedback, scope: 'strategy' },
        });
        await this.advanceStep(pipelineId);
      } else {
        return {
          success: false,
          reason: `Step ${stepName} cannot be rejected (no admin gate)`,
        };
      }

      const fresh = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      return { success: true, data: { run: fresh! } };
    } catch (err) {
      logger.error('BrandPipeline.rejectStep failed', {
        pipelineId,
        stepName,
        err: (err as Error).message,
      });
      return { success: false, reason: (err as Error).message };
    }
  },

  /** Cancel an in-flight run. Does not touch already-created Brand/Strategy. */
  async cancel(
    pipelineId: string,
    userId?: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (run.status === 'COMPLETED' || run.status === 'CANCELLED') {
        return { success: true, data: { run } };
      }
      const updated = await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { status: 'CANCELLED' },
      });
      await this._appendTrace(pipelineId, {
        kind: 'PIPELINE_CANCELLED',
        at: new Date().toISOString(),
        payload: { by: userId ?? null },
      });
      logger.info('BrandPipeline.cancelled', { pipelineId, by: userId });
      return { success: true, data: { run: updated } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /** Mark a run as FAILED with a reason. Idempotent. */
  async fail(
    pipelineId: string,
    reason: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (run.status === 'FAILED') return { success: true, data: { run } };
      const updated = await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { status: 'FAILED', failureReason: reason },
      });
      await this._appendTrace(pipelineId, {
        kind: 'PIPELINE_FAILED',
        at: new Date().toISOString(),
        payload: { reason },
      });
      return { success: true, data: { run: updated } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  // -------------------- LEGACY API (kept for back-compat with routes/tests) --------------------

  /**
   * Legacy: start a pipeline. Returns `{ runId, brandId }`. Throws on error.
   * Prefer `createPipeline` for the new result-shaped API.
   */
  async start(opts: {
    organizationId: string;
    userId: string;
    seed: PipelineSeed;
    horizon?: '30d' | '90d' | '12mo';
    language?: string;
    brandId?: string;
  }): Promise<{ runId: string; brandId: string }> {
    const res = await this.createPipeline({
      organizationId: opts.organizationId,
      userId: opts.userId,
      brandSeed: opts.seed,
      horizon: opts.horizon,
      language: opts.language,
      autoMode: false,
      brandId: opts.brandId,
    });
    if (!res.success || !res.data) throw new Error(res.reason ?? 'Failed to start pipeline');
    const { run } = res.data;
    if (!run.brandId) throw new Error('Brand not created');
    return { runId: run.id, brandId: run.brandId };
  },

  /** Legacy: lightweight get. Returns null if not found, or `{ id, step, status }`. */
  async get(
    id: string,
    organizationId: string,
  ): Promise<{ id: string; step: BrandPipelineStep; status: BrandPipelineStatus } | null> {
    const run = await db.brandPipelineRun.findFirst({
      where: { id, organizationId },
      select: { id: true, step: true, status: true },
    });
    return run;
  },

  /**
   * Legacy: advance the pipeline one step. Returns `{ step, status, awaiting }`.
   * Throws on missing pipeline. Wraps the new `advanceStep` but bumps the step
   * "one unit" like the original implementation (idempotent semantics preserved).
   */
  async advance(
    id: string,
    organizationId: string,
    _userId: string,
  ): Promise<{ step: BrandPipelineStep; status: BrandPipelineStatus; awaiting: 'admin' | null }> {
    const run = await db.brandPipelineRun.findFirst({ where: { id, organizationId } });
    if (!run) throw new Error('Pipeline not found');
    if (run.status === 'COMPLETED' || run.status === 'CANCELLED') {
      return { step: run.step, status: run.status, awaiting: null };
    }
    const res = await this.advanceStep(id);
    if (!res.success || !res.data) throw new Error(res.reason ?? 'Advance failed');
    return {
      step: res.data.run.step,
      status: res.data.run.status,
      awaiting: res.data.awaiting,
    };
  },

  /**
   * Legacy: approve the VALIDATE_PROFILE gate. Throws if not in that step.
   * Returns `{ step, status, awaiting }`.
   */
  async approveProfile(
    id: string,
    userId: string,
  ): Promise<{ step: BrandPipelineStep; status: BrandPipelineStatus; awaiting: 'admin' | null }> {
    const run = await db.brandPipelineRun.findUnique({ where: { id } });
    if (!run) throw new Error('Pipeline not found');
    if (run.step !== 'VALIDATE_PROFILE') {
      throw new Error(`Cannot approve profile in step ${run.step}`);
    }
    // Bypass the per-field gate of approveStep for legacy callers — they
    // expect raw step transition.
    const updated = await db.brandPipelineRun.update({
      where: { id },
      data: {
        step: 'GENERATE_STRATEGY',
        status: 'RUNNING',
        approvedProfileAt: new Date(),
        approvedProfileById: userId,
      },
    });
    await this._appendTrace(id, {
      kind: 'PROFILE_APPROVED',
      at: new Date().toISOString(),
      payload: { by: userId, legacy: true },
    });
    return { step: updated.step, status: updated.status, awaiting: null };
  },

  /** Legacy: approve the VALIDATE_STRATEGY_ITEMS gate. */
  async approveStrategy(
    id: string,
    userId: string,
  ): Promise<{ step: BrandPipelineStep; status: BrandPipelineStatus; awaiting: 'admin' | null }> {
    const run = await db.brandPipelineRun.findUnique({ where: { id } });
    if (!run) throw new Error('Pipeline not found');
    if (run.step !== 'VALIDATE_STRATEGY_ITEMS') {
      throw new Error(`Cannot approve strategy in step ${run.step}`);
    }
    const updated = await db.brandPipelineRun.update({
      where: { id },
      data: {
        step: 'EXECUTE_ITEMS',
        status: 'RUNNING',
        approvedStrategyAt: new Date(),
        approvedStrategyById: userId,
      },
    });
    await this._appendTrace(id, {
      kind: 'STRATEGY_GENERATED',
      at: new Date().toISOString(),
      payload: { by: userId, legacy: true },
    });
    return { step: updated.step, status: updated.status, awaiting: null };
  },

  // -------------------- FIELD-LEVEL ACTIONS (used by UI/admin) --------------------

  async editField(
    pipelineId: string,
    field: BrandProfileField,
    value: unknown,
    userId: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      const fieldStates = readFieldStates(run);
      const cur = fieldStates[field] ?? emptyFieldState();
      fieldStates[field] = {
        ...cur,
        status: 'EDITED',
        value,
        history: [
          ...cur.history,
          { at: new Date().toISOString(), by: userId, value, source: 'user' },
        ],
        rejectedReason: undefined,
      };
      const updated = await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { fieldStates: fieldStates as never },
      });
      await this._appendTrace(pipelineId, {
        kind: 'FIELD_EDIT',
        at: new Date().toISOString(),
        payload: { field, by: userId },
      });
      return { success: true, data: { run: updated } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  async approveField(
    pipelineId: string,
    field: BrandProfileField,
    userId: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      const fieldStates = readFieldStates(run);
      const cur = fieldStates[field] ?? emptyFieldState();
      fieldStates[field] = { ...cur, status: 'APPROVED', rejectedReason: undefined };
      const updated = await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { fieldStates: fieldStates as never },
      });
      await this._appendTrace(pipelineId, {
        kind: 'FIELD_APPROVED',
        at: new Date().toISOString(),
        payload: { field, by: userId },
      });
      return { success: true, data: { run: updated } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  async rejectField(
    pipelineId: string,
    field: BrandProfileField,
    reason: string,
    userId: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      const fieldStates = readFieldStates(run);
      const cur = fieldStates[field] ?? emptyFieldState();
      fieldStates[field] = { ...cur, status: 'REJECTED', rejectedReason: reason };
      const updated = await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { fieldStates: fieldStates as never },
      });
      await this._appendTrace(pipelineId, {
        kind: 'FIELD_REJECTED',
        at: new Date().toISOString(),
        payload: { field, by: userId, reason },
      });
      return { success: true, data: { run: updated } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /** Regenerate a single field via AI. Stores result as PROPOSED. */
  async enrichField(
    pipelineId: string,
    field: BrandProfileField,
  ): Promise<PipelineResult<{ value: unknown; mocked: boolean }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (!run.brandId) return { success: false, reason: 'Brand not created yet' };

      const proposal = await this._proposeFieldsViaAI(run, [field]);
      const value = proposal.suggestions[field];

      const fieldStates = readFieldStates(run);
      const cur = fieldStates[field] ?? emptyFieldState();
      fieldStates[field] = {
        ...cur,
        status: 'PROPOSED',
        value: value ?? cur.value,
        history: [
          ...cur.history,
          { at: new Date().toISOString(), by: 'agent', value, source: 'ai' },
        ],
        rejectedReason: undefined,
      };
      await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { fieldStates: fieldStates as never },
      });
      await this._appendTrace(pipelineId, {
        kind: 'FIELD_PROPOSED',
        at: new Date().toISOString(),
        payload: { field, mocked: proposal.mocked },
      });

      return { success: true, data: { value, mocked: proposal.mocked } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /**
   * Persist an approved value to brand.profile + record APPROVED on the run.
   * Does NOT trigger a step transition on its own.
   */
  async approveProfileField(
    pipelineId: string,
    fieldName: BrandProfileField,
    value: unknown,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (!run.brandId) return { success: false, reason: 'Brand not created yet' };
      if (!BRAND_PROFILE_FIELDS.includes(fieldName)) {
        return { success: false, reason: `Unknown field ${fieldName}` };
      }

      const at = new Date().toISOString();
      const fieldStates = readFieldStates(run);
      const cur = fieldStates[fieldName] ?? emptyFieldState();
      fieldStates[fieldName] = {
        ...cur,
        status: 'APPROVED',
        value,
        history: [
          ...cur.history,
          { at, by: 'user', value, source: 'user' },
        ],
        rejectedReason: undefined,
      };

      // Persist the approved value into BrandProfile (one field at a time).
      const arrayFields: readonly string[] = ['wordsToUse', 'wordsToAvoid', 'officialHashtags'];
      let persistedValue: unknown;
      if (arrayFields.includes(fieldName)) {
        persistedValue = Array.isArray(value)
          ? value
          : typeof value === 'string'
            ? value.split(/[,\s]+/).filter(Boolean)
            : [];
      } else {
        persistedValue =
          value == null ? null : typeof value === 'string' ? value : JSON.stringify(value);
      }

      await db.brandProfile.update({
        where: { brandId: run.brandId },
        data: { [fieldName]: persistedValue } as never,
      });

      const updated = await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { fieldStates: fieldStates as never },
      });
      await this._appendTrace(pipelineId, {
        kind: 'FIELD_APPROVED',
        at,
        payload: { field: fieldName, persisted: true },
      });

      return { success: true, data: { run: updated } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /**
   * Regenerate a single brand-profile field via the AI router, optionally
   * incorporating user feedback. Stores the new proposal in run.fieldStates.
   */
  async regenerateProfileField(
    pipelineId: string,
    fieldName: BrandProfileField,
    feedback?: string,
  ): Promise<PipelineResult<{ value: unknown; mocked: boolean }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (!run.brandId) return { success: false, reason: 'Brand not created yet' };
      if (!BRAND_PROFILE_FIELDS.includes(fieldName)) {
        return { success: false, reason: `Unknown field ${fieldName}` };
      }

      const brand = await db.brand.findUnique({
        where: { id: run.brandId },
        include: { profile: true },
      });
      const seed = readSeed(run);
      const brandName = brand?.name ?? seed.name;
      const industry = brand?.industry ?? seed.industry ?? null;
      const description = brand?.description ?? seed.description ?? null;

      const contextLines: string[] = [`Marque: ${brandName}`];
      if (industry) contextLines.push(`Industrie: ${industry}`);
      if (description) contextLines.push(`Description: ${description}`);
      if (feedback) contextLines.push(`Feedback utilisateur: ${feedback}`);

      const prompt = `Tu es un brand strategist. Génère UNE proposition pour le champ "${fieldName}".

CONTEXTE :
${contextLines.join('\n')}

CHAMP DEMANDÉ :
  - ${fieldName}: ${FIELD_PROMPTS[fieldName]}

Réponds UNIQUEMENT en JSON valide avec exactement la clé "${fieldName}". Pas de markdown.

Exemple :
{ "${fieldName}": ... }`;

      const result = await AIRouterService.generateTextForTask('TEXT_STRUCTURED_JSON', {
        prompt,
        language: run.language,
        maxTokens: 800,
        temperature: 0.85,
      });

      let value: unknown = null;
      const parsed = parseJsonObject(result.text);
      if (parsed && fieldName in parsed) value = parsed[fieldName];

      if (result.mocked && value == null) {
        value = this._mockSuggestions(brandName, industry, [fieldName])[fieldName];
      }

      const at = new Date().toISOString();
      const fieldStates = readFieldStates(run);
      const cur = fieldStates[fieldName] ?? emptyFieldState();
      fieldStates[fieldName] = {
        ...cur,
        status: 'PROPOSED',
        value: value ?? cur.value,
        history: [
          ...cur.history,
          { at, by: 'agent', value, source: 'ai' },
        ],
        rejectedReason: undefined,
      };
      await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { fieldStates: fieldStates as never },
      });
      await this._appendTrace(pipelineId, {
        kind: 'FIELD_PROPOSED',
        at,
        payload: { field: fieldName, mocked: result.mocked, feedback: feedback ?? null },
      });

      return { success: true, data: { value, mocked: result.mocked } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /**
   * Bulk-approve every profile field with its current proposed/edited value
   * and transition the pipeline to GENERATE_STRATEGY.
   */
  async approveAllProfileFields(
    pipelineId: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (!run.brandId) return { success: false, reason: 'Brand not created yet' };

      const at = new Date().toISOString();
      const fieldStates = readFieldStates(run);
      for (const f of BRAND_PROFILE_FIELDS) {
        const cur = fieldStates[f] ?? emptyFieldState();
        if (cur.status === 'REJECTED' || cur.value == null) continue;
        fieldStates[f] = { ...cur, status: 'APPROVED', rejectedReason: undefined };
      }

      // Flush approved values into BrandProfile.
      const persisted = await this._persistApprovedProfileToDb(pipelineId);
      if (!persisted.success) {
        return { success: false, reason: persisted.reason };
      }

      const updated = await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: {
          fieldStates: fieldStates as never,
          step: 'GENERATE_STRATEGY',
          status: 'RUNNING',
          approvedProfileAt: new Date(),
        },
      });
      await this._appendTrace(pipelineId, {
        kind: 'PROFILE_APPROVED',
        at,
        payload: { bulk: true },
      });

      return { success: true, data: { run: updated } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  // -------------------- ITEM-LEVEL ACTIONS --------------------

  async approveItem(
    pipelineId: string,
    itemId: string,
    userId: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      const states = readItemStates(run);
      states[itemId] = {
        ...(states[itemId] ?? { status: 'PROPOSED' }),
        status: 'APPROVED',
      };
      await db.strategyItem
        .update({ where: { id: itemId }, data: { status: 'APPROVED' } })
        .catch(() => undefined);
      const updated = await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { itemStates: states as never },
      });
      await this._appendTrace(pipelineId, {
        kind: 'ITEM_APPROVED',
        at: new Date().toISOString(),
        payload: { itemId, by: userId },
      });
      return { success: true, data: { run: updated } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  async rejectItem(
    pipelineId: string,
    itemId: string,
    reason: string,
    userId: string,
  ): Promise<PipelineResult<{ run: BrandPipelineRun }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      const states = readItemStates(run);
      states[itemId] = {
        ...(states[itemId] ?? { status: 'PROPOSED' }),
        status: 'REJECTED',
        rejectedReason: reason,
      };
      await db.strategyItem
        .update({ where: { id: itemId }, data: { status: 'REJECTED' } })
        .catch(() => undefined);
      const updated = await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { itemStates: states as never },
      });
      await this._appendTrace(pipelineId, {
        kind: 'ITEM_REJECTED',
        at: new Date().toISOString(),
        payload: { itemId, by: userId, reason },
      });
      return { success: true, data: { run: updated } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  async regenerateItem(
    pipelineId: string,
    itemId: string,
    extraInstruction?: string,
  ): Promise<PipelineResult<{ mocked: boolean }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      const out = await MarketingStrategyService.regenerateItem(
        itemId,
        run.organizationId,
        extraInstruction,
      );
      const states = readItemStates(run);
      states[itemId] = {
        ...(states[itemId] ?? { status: 'PROPOSED' }),
        status: 'PROPOSED',
      };
      await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { itemStates: states as never },
      });
      return { success: true, data: { mocked: out.mocked } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /**
   * List approved StrategyItems for this pipeline along with their
   * concretization state (read from `metadata.concretization.status`).
   * Useful for the per-item concretization UI.
   */
  async listItemsForConcretization(
    pipelineId: string,
  ): Promise<
    PipelineResult<{
      items: Array<{
        id: string;
        title: string;
        platform: string | null;
        format: string | null;
        suggestedDate: Date | null;
        status: ItemStatus;
        concretization: 'ready' | 'pending' | 'producing' | 'failed';
        postId: string | null;
      }>;
    }>
  > {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (!run.strategyId) return { success: true, data: { items: [] } };

      const states = readItemStates(run);
      const approvedIds = Object.entries(states)
        .filter(([, s]) => s.status === 'APPROVED' || s.status === 'EDITED')
        .map(([id]) => id);
      if (approvedIds.length === 0) return { success: true, data: { items: [] } };

      const rows = await db.strategyItem.findMany({
        where: { id: { in: approvedIds }, strategyId: run.strategyId },
        select: {
          id: true,
          title: true,
          platform: true,
          format: true,
          suggestedDate: true,
          postId: true,
          metadata: true,
        },
      });

      const items = rows.map((it) => {
        const meta = (it.metadata ?? {}) as Record<string, unknown>;
        const conc = (meta.concretization ?? {}) as Record<string, unknown>;
        const rawStatus = conc.status;
        const concretization: 'ready' | 'pending' | 'producing' | 'failed' =
          rawStatus === 'ready' || rawStatus === 'producing' || rawStatus === 'failed'
            ? rawStatus
            : 'pending';
        return {
          id: it.id,
          title: it.title,
          platform: it.platform,
          format: it.format,
          suggestedDate: it.suggestedDate,
          status: (states[it.id]?.status ?? 'APPROVED') as ItemStatus,
          concretization,
          postId: it.postId,
        };
      });

      return { success: true, data: { items } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /**
   * Dispatch an action on a strategy item:
   *  - `share`     → create a MANUAL PostSchedule scheduled for now,
   *                  mark `manualSharedAt`.
   *  - `schedule`  → create a PostSchedule for `payload.scheduledFor`,
   *                  AUTO if `payload.socialAccountId` is provided,
   *                  MANUAL otherwise.
   *  - `publish`   → if a SocialAccount exists for the item's platform,
   *                  publish immediately via SocialPublisherService;
   *                  else throw "Compte non connecté".
   */
  async dispatchItemAction(
    itemId: string,
    action: 'share' | 'schedule' | 'publish',
    payload?: {
      socialAccountId?: string;
      socialPageId?: string;
      scheduledFor?: Date | string;
    },
  ): Promise<
    PipelineResult<{
      scheduleId?: string;
      postId: string;
      published?: boolean;
      simulated?: boolean;
      externalPostId?: string;
    }>
  > {
    try {
      const item = await db.strategyItem.findUnique({
        where: { id: itemId },
        include: { strategy: true },
      });
      if (!item) return { success: false, reason: 'Strategy item not found' };
      if (!item.postId) {
        return {
          success: false,
          reason: 'Item not yet concretized — no Post exists. Run concretization first.',
        };
      }

      const post = await db.post.findUnique({
        where: { id: item.postId },
        include: { media: true },
      });
      if (!post) return { success: false, reason: 'Linked post not found' };

      const organizationId = post.organizationId;
      const brandId = post.brandId;
      const platformStr = (item.platform ?? '').toUpperCase();
      const VALID_PLATFORMS: SocialPlatform[] = [
        'FACEBOOK',
        'INSTAGRAM',
        'LINKEDIN',
        'TWITTER',
        'TIKTOK',
        'YOUTUBE',
        'PINTEREST',
      ];
      const platform = (VALID_PLATFORMS as string[]).includes(platformStr)
        ? (platformStr as SocialPlatform)
        : null;

      if (action === 'share') {
        const now = new Date();
        const schedule = await db.postSchedule.create({
          data: {
            postId: post.id,
            scheduledFor: now,
            shareMode: 'MANUAL',
            manualSharedAt: now,
            status: 'SCHEDULED',
          },
        });
        return {
          success: true,
          data: { scheduleId: schedule.id, postId: post.id },
        };
      }

      if (action === 'schedule') {
        const scheduledFor = payload?.scheduledFor
          ? new Date(payload.scheduledFor)
          : item.suggestedDate ?? new Date();
        const shareMode = payload?.socialAccountId ? 'AUTO' : 'MANUAL';
        const schedule = await db.postSchedule.create({
          data: {
            postId: post.id,
            socialAccountId: payload?.socialAccountId ?? null,
            socialPageId: payload?.socialPageId ?? null,
            scheduledFor,
            shareMode,
            status: 'SCHEDULED',
          },
        });
        return {
          success: true,
          data: { scheduleId: schedule.id, postId: post.id },
        };
      }

      // action === 'publish'
      if (!platform) {
        throw new Error('Plateforme inconnue sur l\'item');
      }
      const account = await db.socialAccount.findFirst({
        where: {
          organizationId,
          platform,
          ...(brandId ? { OR: [{ brandId }, { brandId: null }] } : {}),
        },
        orderBy: [{ brandId: 'desc' }, { createdAt: 'desc' }],
      });
      if (!account) {
        throw new Error('Compte non connecté');
      }

      const schedule = await db.postSchedule.create({
        data: {
          postId: post.id,
          socialAccountId: account.id,
          socialPageId: payload?.socialPageId ?? null,
          scheduledFor: new Date(),
          shareMode: 'AUTO',
          status: 'SCHEDULED',
        },
      });

      const result = await SocialPublisherService.publishNow({
        postId: post.id,
        scheduleId: schedule.id,
        socialAccountId: account.id,
        socialPageId: payload?.socialPageId,
        body: post.body ?? '',
        hashtags: post.hashtags ?? [],
        mediaUrls: (post.media ?? []).map((m) => m.url),
        cta: post.cta ?? undefined,
        linkUrl: post.linkUrl ?? undefined,
      });

      if (!result.success) {
        return {
          success: false,
          reason: result.error ?? 'Publication échouée',
        };
      }
      return {
        success: true,
        data: {
          scheduleId: schedule.id,
          postId: post.id,
          // A simulated run is NOT a publication — surface the difference.
          published: !result.simulated,
          simulated: result.simulated,
          externalPostId: result.externalPostId,
        },
      };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  // -------------------- CLIENT VIEW --------------------

  /**
   * Shape a run for client consumption (collapses long JSON into summaries).
   */
  toClientView(run: BrandPipelineRun): PipelineClientView {
    const fieldStates = readFieldStates(run);
    const itemStates = readItemStates(run);
    const trace = readTrace(run);
    const execLog = readExecutionLog(run);
    const seedRaw = readSeed(run);
    const { _autoMode, ...seed } = seedRaw;
    const autoMode = _autoMode !== false;

    const fields = BRAND_PROFILE_FIELDS.map((name) => {
      const s = fieldStates[name] ?? emptyFieldState();
      return {
        name,
        status: s.status,
        value: s.value,
        rejectedReason: s.rejectedReason,
        historyLen: s.history?.length ?? 0,
      };
    });

    const fieldsSummary = fields.reduce(
      (acc, f) => {
        acc.total += 1;
        if (f.status === 'PENDING') acc.pending += 1;
        else if (f.status === 'PROPOSED') acc.proposed += 1;
        else if (f.status === 'APPROVED' || f.status === 'EDITED') acc.approved += 1;
        else if (f.status === 'REJECTED') acc.rejected += 1;
        return acc;
      },
      { total: 0, pending: 0, proposed: 0, approved: 0, rejected: 0 },
    );

    const items = Object.entries(itemStates).map(([id, s]) => ({
      id,
      status: s.status,
      rejectedReason: s.rejectedReason,
      warnings: s.warnings,
    }));

    const itemsSummary = items.reduce(
      (acc, it) => {
        acc.total += 1;
        if (it.status === 'APPROVED' || it.status === 'EDITED') acc.approved += 1;
        else if (it.status === 'REJECTED') acc.rejected += 1;
        else if (it.status === 'EXECUTED') acc.executed += 1;
        return acc;
      },
      { total: 0, approved: 0, rejected: 0, executed: 0 },
    );

    return {
      id: run.id,
      organizationId: run.organizationId,
      brandId: run.brandId,
      strategyId: run.strategyId,
      status: run.status,
      step: run.step,
      horizon: run.horizon,
      language: run.language,
      autoMode,
      seed,
      awaitingAdmin: run.status === 'AWAITING_ADMIN',
      approvedProfileAt: run.approvedProfileAt,
      approvedStrategyAt: run.approvedStrategyAt,
      completedAt: run.completedAt,
      failureReason: run.failureReason,
      fields,
      fieldsSummary,
      items,
      itemsSummary,
      executionLog: execLog,
      recentTrace: trace.slice(-20),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  },

  // -------------------- INTERNAL STEP IMPLEMENTATIONS --------------------

  /** CREATE_BRAND: create Brand row + empty BrandProfile. */
  async _performCreateBrand(
    pipelineId: string,
  ): Promise<PipelineResult<{ brandId: string }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (run.brandId) return { success: true, data: { brandId: run.brandId } };

      const seed = readSeed(run);
      if (!seed.name) return { success: false, reason: 'Seed name is required' };

      const slug = await uniqueBrandSlug(run.organizationId, seed.name);

      const brand = await db.brand.create({
        data: {
          organizationId: run.organizationId,
          clientId: seed.clientId,
          name: seed.name,
          slug,
          industry: seed.industry,
          description: seed.description,
          profile: { create: {} },
        },
      });

      await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { brandId: brand.id },
      });

      logger.info('BrandPipeline.brandCreated', {
        pipelineId,
        brandId: brand.id,
        slug,
      });
      return { success: true, data: { brandId: brand.id } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /** ENRICH_PROFILE: fan out AI proposals for the 11 fields. */
  async _performEnrichProfile(
    pipelineId: string,
  ): Promise<PipelineResult<{ proposed: number }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (!run.brandId) return { success: false, reason: 'Brand not created yet' };

      const fieldStates = readFieldStates(run);
      let toEnrich: BrandProfileField[] = BRAND_PROFILE_FIELDS.filter((f) => {
        const s = fieldStates[f];
        return !s || s.status === 'PENDING' || s.status === 'REJECTED';
      });

      if (toEnrich.length === 0) {
        return { success: true, data: { proposed: 0 } };
      }

      // Les données déjà saisies sur la marque (slogan, charte graphique…) sont
      // la vérité : on les propose telles quelles au lieu de les réinventer.
      // Seuls les champs encore vides partent à l'IA.
      const profile = await db.brandProfile.findUnique({ where: { brandId: run.brandId } });
      const prefillNow = new Date().toISOString();
      if (profile) {
        const fromProfile: Partial<Record<BrandProfileField, unknown>> = {
          slogan: profile.slogan,
          mission: profile.mission,
          audienceTarget: profile.audienceTarget,
          toneOfVoice: profile.toneOfVoice,
          wordsToUse: profile.wordsToUse,
          wordsToAvoid: profile.wordsToAvoid,
          officialHashtags: profile.officialHashtags,
          primaryColor: profile.primaryColor,
          secondaryColor: profile.secondaryColor,
          accentColor: profile.accentColor,
          visualStyle: profile.visualStyle,
        };
        const prefilled: BrandProfileField[] = [];
        for (const f of toEnrich) {
          const v = fromProfile[f];
          const empty = v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);
          if (empty) continue;
          const cur = fieldStates[f] ?? emptyFieldState();
          fieldStates[f] = {
            ...cur,
            status: 'PROPOSED',
            value: v,
            history: [...cur.history, { at: prefillNow, by: 'agent', value: v, source: 'profile' }],
            rejectedReason: undefined,
          };
          prefilled.push(f);
        }
        toEnrich = toEnrich.filter((f) => !prefilled.includes(f));
        if (prefilled.length > 0) {
          await this._appendTrace(pipelineId, {
            kind: 'FIELD_PROPOSED',
            at: prefillNow,
            payload: { fields: prefilled, source: 'brand-profile' },
          });
        }
      }

      if (toEnrich.length === 0) {
        await db.brandPipelineRun.update({
          where: { id: pipelineId },
          data: { fieldStates: fieldStates as never },
        });
        return { success: true, data: { proposed: BRAND_PROFILE_FIELDS.length } };
      }

      const result = await this._proposeFieldsViaAI(run, toEnrich);
      const now = new Date().toISOString();
      for (const f of toEnrich) {
        const value = result.suggestions[f];
        const cur = fieldStates[f] ?? emptyFieldState();
        fieldStates[f] = {
          ...cur,
          status: 'PROPOSED',
          value: value ?? cur.value,
          history: [...cur.history, { at: now, by: 'agent', value, source: 'ai' }],
          rejectedReason: undefined,
        };
      }

      await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { fieldStates: fieldStates as never },
      });
      await this._appendTrace(pipelineId, {
        kind: 'FIELD_PROPOSED',
        at: now,
        payload: { fields: toEnrich, mocked: result.mocked },
      });

      logger.info('BrandPipeline.enrichProfile.done', {
        pipelineId,
        fields: toEnrich.length,
        mocked: result.mocked,
      });
      return { success: true, data: { proposed: toEnrich.length } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /**
   * Call the AI to propose values for the requested fields. Mirrors the logic
   * in /api/ai/enrich/brand-profile, as a pure service call.
   */
  async _proposeFieldsViaAI(
    run: BrandPipelineRun,
    fields: BrandProfileField[],
  ): Promise<{
    suggestions: Partial<Record<BrandProfileField, unknown>>;
    mocked: boolean;
  }> {
    const brand = run.brandId
      ? await db.brand.findUnique({
          where: { id: run.brandId },
          include: { profile: true },
        })
      : null;

    const seed = readSeed(run);
    const fieldStates = readFieldStates(run);
    const brandName = brand?.name ?? seed.name;
    const industry = brand?.industry ?? seed.industry ?? null;
    const description = brand?.description ?? seed.description ?? null;
    const slug = brand?.slug ?? buildSlug(brandName);

    const contextLines: string[] = [`Marque: ${brandName}`];
    if (industry) contextLines.push(`Industrie: ${industry}`);
    if (description) contextLines.push(`Description: ${description}`);
    if (seed.website) contextLines.push(`Site web: ${seed.website}`);
    if (seed.audienceHint) contextLines.push(`Indice audience: ${seed.audienceHint}`);

    for (const f of BRAND_PROFILE_FIELDS) {
      const s = fieldStates[f];
      if (!s) continue;
      if ((s.status === 'APPROVED' || s.status === 'EDITED') && s.value != null) {
        const display = Array.isArray(s.value)
          ? (s.value as unknown[]).join(', ')
          : String(s.value);
        contextLines.push(`${f} (validé): ${display}`);
      }
      if (s.status === 'REJECTED' && s.rejectedReason) {
        contextLines.push(`${f} rejeté — raison: ${s.rejectedReason}`);
      }
    }
    if (run.adminNotes) contextLines.push(`Notes admin: ${run.adminNotes.slice(0, 500)}`);

    const requestedFields = fields
      .map((f) => `  - ${f}: ${FIELD_PROMPTS[f]}`)
      .join('\n');

    const prompt = `Tu es un brand strategist. À partir de ce contexte de marque, génère des suggestions COHÉRENTES pour les champs demandés.

CONTEXTE :
${contextLines.join('\n')}

CHAMPS À REMPLIR :
${requestedFields}

Règles :
- Cohérence stricte avec les valeurs validées (ne contredis pas la marque)
- Palette HEX harmonieuse si plusieurs couleurs demandées
- Hashtags: mélange marque (#${slug.replace(/-/g, '')}) + industrie
- Respecte les "rejected reasons" — produis quelque chose de NETTEMENT différent

Réponds UNIQUEMENT en JSON valide avec exactement les champs demandés. Pas de markdown.

Exemple :
{
  "slogan": "...",
  "officialHashtags": ["#foo", "#bar"]
}`;

    const result = await AIProviderService.generateText({
      prompt,
      language: run.language,
      maxTokens: 1500,
      temperature: 0.8,
    });

    let suggestions: Partial<Record<BrandProfileField, unknown>> = {};
    const parsed = parseJsonObject(result.text);
    if (parsed) {
      for (const f of fields) {
        if (f in parsed) suggestions[f] = parsed[f];
      }
    }

    if (result.mocked && Object.keys(suggestions).length === 0) {
      suggestions = this._mockSuggestions(brandName, industry, fields);
    }

    return { suggestions, mocked: result.mocked };
  },

  _mockSuggestions(
    brandName: string,
    industry: string | null,
    fields: BrandProfileField[],
  ): Partial<Record<BrandProfileField, unknown>> {
    const mock: Partial<Record<BrandProfileField, unknown>> = {
      slogan: `[MOCK] ${brandName} — votre solution ${industry ? `pour ${industry.toLowerCase()}` : 'unique'}`,
      mission: `[MOCK] Chez ${brandName}, nous transformons l'expérience client${industry ? ` dans le ${industry.toLowerCase()}` : ''}.`,
      audienceTarget: 'Professionnels 25-45 ans cherchant authenticité et excellence',
      toneOfVoice: 'inspirant, expert, accessible',
      wordsToUse: ['authentique', 'qualité', 'innovation', 'communauté', 'durable', 'créatif'],
      wordsToAvoid: ['cheap', 'urgent', 'gratuit', 'révolutionnaire'],
      officialHashtags: [
        `#${brandName.toLowerCase().replace(/\s+/g, '')}`,
        '#design',
        '#innovation',
      ],
      primaryColor: '#3d62f5',
      secondaryColor: '#1a2e8c',
      accentColor: '#ff6b6b',
      visualStyle: 'minimal, éditorial',
    };
    const out: Partial<Record<BrandProfileField, unknown>> = {};
    for (const f of fields) out[f] = mock[f];
    return out;
  },

  /**
   * Persist all APPROVED/EDITED field values to BrandProfile.
   */
  async _persistApprovedProfileToDb(
    pipelineId: string,
  ): Promise<PipelineResult<{ brandId: string }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (!run.brandId) return { success: false, reason: 'Brand not created yet' };

      const fieldStates = readFieldStates(run);
      const profileData: Record<string, unknown> = {};
      const arrayFields: readonly string[] = ['wordsToUse', 'wordsToAvoid', 'officialHashtags'];

      for (const f of BRAND_PROFILE_FIELDS) {
        const s = fieldStates[f];
        if (!s || (s.status !== 'APPROVED' && s.status !== 'EDITED')) continue;
        if (s.value == null) continue;
        if (arrayFields.includes(f)) {
          profileData[f] = Array.isArray(s.value)
            ? s.value
            : typeof s.value === 'string'
              ? s.value.split(/[,\s]+/).filter(Boolean)
              : [];
        } else {
          profileData[f] = typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
        }
      }

      await db.brandProfile.update({
        where: { brandId: run.brandId },
        data: profileData as never,
      });

      logger.info('BrandPipeline.profilePersisted', {
        pipelineId,
        brandId: run.brandId,
        fields: Object.keys(profileData),
      });
      return { success: true, data: { brandId: run.brandId } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /**
   * Verrou d'avancement — réservation conditionnelle du run pour une étape.
   * Deux /advance concurrents (double onglet, F5 pendant une étape longue de
   * plusieurs minutes) exécutaient le même travail deux fois : deux stratégies
   * créées, concrétisations facturées en double, deux créneaux AUTO publiés.
   * Un verrou de plus de 10 min est considéré périmé (invocation tuée).
   */
  async _claimRun(pipelineId: string, step: BrandPipelineStep): Promise<boolean> {
    try {
      const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
      const res = await db.brandPipelineRun.updateMany({
        where: {
          id: pipelineId,
          step,
          OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
        },
        data: { lockedAt: new Date() },
      });
      return res.count === 1;
    } catch {
      // Environnement de test / DB non migrée (colonne lockedAt absente) :
      // on n'empêche pas le travail, on perd juste le verrou.
      return true;
    }
  },

  async _releaseRun(pipelineId: string): Promise<void> {
    await db.brandPipelineRun
      .update({ where: { id: pipelineId }, data: { lockedAt: null } })
      .catch(() => undefined);
  },

  /**
   * Nettoie le travail GÉNÉRÉ par une stratégie : posts non publiés supprimés,
   * items déliés et remis à zéro (metadata de concrétisation effacée,
   * EXECUTED → APPROVED). Partagé entre la purge (DELETE ?purgePosts=1) et le
   * rejet d'étape — avant, le rejet laissait posts et créneaux orphelins
   * continuer à se publier.
   */
  async _purgeStrategyGeneratedWork(strategyId: string, organizationId: string): Promise<void> {
    const items = await db.strategyItem.findMany({
      where: { strategyId },
      select: { id: true, postId: true, campaignId: true, status: true, metadata: true },
    });
    const postIds = items.map((i) => i.postId).filter((p): p is string => !!p);

    // Les posts PUBLIÉS sont épargnés — et leurs items avec : les délier et
    // les repasser APPROVED faisait re-générer puis RE-PUBLIER un contenu
    // déjà en ligne au run suivant.
    const publishedPosts = postIds.length
      ? await db.post.findMany({
          where: { id: { in: postIds }, organizationId, status: 'PUBLISHED' },
          select: { id: true },
        })
      : [];
    const publishedPostIds = new Set(publishedPosts.map((p) => p.id));

    // Médias GÉNÉRÉS pour ces posts : collectés AVANT la suppression (la
    // relation m2m disparaît avec le post) — sans cela ils restaient orphelins
    // et « revenaient » dans le pipeline suivant via recentMedia (par marque).
    const toDeleteIds = postIds.filter((p) => !publishedPostIds.has(p));
    const generatedMedia = toDeleteIds.length
      ? await db.mediaAsset.findMany({
          where: {
            organizationId,
            posts: { some: { id: { in: toDeleteIds } } },
            source: { in: ['ai', 'branding'] },
          },
          select: { id: true },
        })
      : [];

    if (toDeleteIds.length > 0) {
      await db.post.deleteMany({
        where: { id: { in: toDeleteIds }, organizationId, status: { not: 'PUBLISHED' } },
      });
    }
    if (generatedMedia.length > 0) {
      // Uniquement ceux qui ne sont plus liés à AUCUN post (un asset réutilisé
      // ailleurs survit).
      await db.mediaAsset
        .deleteMany({
          where: { id: { in: generatedMedia.map((m) => m.id) }, posts: { none: {} } },
        })
        .catch(() => undefined);
    }

    // Campagnes créées par l'exécution : les brouillons partent avec la purge
    // (une campagne travaillée/activée est conservée) — sinon chaque
    // ré-exécution empilait une campagne en double.
    const campaignIds = items.map((i) => i.campaignId).filter((c): c is string => !!c);
    if (campaignIds.length > 0) {
      await db.campaign
        .deleteMany({ where: { id: { in: campaignIds }, organizationId, status: 'DRAFT' } })
        .catch(() => undefined);
    }

    const INHERITED_KEYS = [
      'concretization', 'caption', 'imageVariants', 'videoScript',
      'emailSubject', 'emailBody', 'status', 'readyAt', 'readyById',
    ];
    for (const it of items) {
      // Item dont le post publié survit : on ne touche à RIEN — il reste
      // EXECUTED et lié, le prochain run le saute au lieu de le dupliquer.
      if (it.postId && publishedPostIds.has(it.postId)) continue;
      const meta = { ...((it.metadata as Record<string, unknown> | null) ?? {}) };
      for (const k of INHERITED_KEYS) delete meta[k];
      await db.strategyItem.update({
        where: { id: it.id },
        data: {
          postId: null,
          campaignId: null,
          ...(it.status === 'EXECUTED' ? { status: 'APPROVED' } : {}),
          metadata: meta as never,
        },
      });
    }

    // Les runs (conservés — annulés/terminés) qui référencent cette stratégie
    // gardent des postId/scheduleId morts dans itemStates : l'UI proposait
    // encore « Planifier/Publier » sur des posts supprimés (404).
    const runs = await db.brandPipelineRun.findMany({
      where: { strategyId, organizationId },
      select: { id: true, itemStates: true },
    });
    for (const r of runs) {
      const states = ((r.itemStates as Record<string, ItemState> | null) ?? {});
      let touched = false;
      for (const [itemId, s] of Object.entries(states)) {
        if (s.postId && !publishedPostIds.has(s.postId)) {
          states[itemId] = { ...s, postId: undefined, scheduleId: undefined, campaignId: undefined };
          touched = true;
        }
      }
      if (touched) {
        await db.brandPipelineRun
          .update({ where: { id: r.id }, data: { itemStates: states as never } })
          .catch(() => undefined);
      }
    }
  },

  /** GENERATE_STRATEGY: call MarketingStrategyService.generate + save. */
  async _performGenerateStrategy(
    pipelineId: string,
  ): Promise<PipelineResult<{ strategyId: string; itemCount: number }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (!run.brandId) return { success: false, reason: 'Brand not created yet' };

      // IDEMPOTENCE : une stratégie est déjà liée au run (relance après
      // timeout, double advance) — ne jamais en générer une seconde. Avant,
      // chaque relance avec forceNewStrategy créait une stratégie de plus,
      // jamais archivée, réutilisable par erreur par un futur pipeline.
      if (run.strategyId) {
        const current = await db.marketingStrategy.findUnique({
          where: { id: run.strategyId },
          include: { items: { select: { id: true } } },
        });
        if (current && current.items.length > 0) {
          return {
            success: true,
            data: { strategyId: current.id, itemCount: current.items.length },
          };
        }
      }

      const seed = readSeed(run);

      // Adopte une stratégie existante : lie le run + recopie les statuts d'items.
      const adopt = async (strategy: { id: string; items: Array<{ id: string; status: string }> }) => {
        const itemStates: Record<string, ItemState> = {};
        for (const it of strategy.items) {
          const status = (['PROPOSED', 'EDITED', 'APPROVED', 'REJECTED', 'EXECUTED'] as const)
            .includes(it.status as ItemStatus) ? (it.status as ItemStatus) : 'PROPOSED';
          itemStates[it.id] = { status };
        }
        await db.brandPipelineRun.update({
          where: { id: pipelineId },
          data: { strategyId: strategy.id, itemStates: itemStates as never },
        });
        await this._appendTrace(pipelineId, {
          kind: 'STRATEGY_GENERATED',
          at: new Date().toISOString(),
          payload: { strategyId: strategy.id, itemCount: strategy.items.length, reused: true },
        });
        logger.info('BrandPipeline.strategyReused', {
          pipelineId,
          strategyId: strategy.id,
          itemCount: strategy.items.length,
        });
        return { success: true as const, data: { strategyId: strategy.id, itemCount: strategy.items.length } };
      };

      // 1) Stratégie explicitement choisie au lancement du pipeline.
      if (seed.strategyId && !seed.forceNewStrategy) {
        const chosen = await db.marketingStrategy.findFirst({
          where: { id: seed.strategyId, organizationId: run.organizationId, brandId: run.brandId },
          include: { items: true },
        });
        if (!chosen) {
          return { success: false, reason: 'Stratégie choisie introuvable pour cette marque — relance ou choisis-en une autre.' };
        }
        if (chosen.items.length === 0) {
          return { success: false, reason: 'La stratégie choisie ne contient aucun item.' };
        }
        const activeClaim = await db.brandPipelineRun.findFirst({
          where: {
            strategyId: chosen.id,
            id: { not: pipelineId },
            status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] },
          },
          select: { id: true },
        });
        if (activeClaim) {
          return { success: false, reason: 'La stratégie choisie est déjà utilisée par un autre pipeline en cours.' };
        }
        return await adopt(chosen);
      }

      // 2) Réutilisation auto de la plus récente (sauf refus explicite) — ex.
      // stratégie générée depuis des documents sur Marques → Stratégie.
      if (!seed.forceNewStrategy) {
        const existing = await db.marketingStrategy.findFirst({
          where: {
            organizationId: run.organizationId,
            brandId: run.brandId,
            status: { not: 'ARCHIVED' },
          },
          orderBy: { createdAt: 'desc' },
          include: { items: true },
        });
        if (existing && existing.items.length > 0) {
          const claimed = await db.brandPipelineRun.findFirst({
            where: { strategyId: existing.id, id: { not: pipelineId } },
            select: { id: true },
          });
          if (!claimed) return await adopt(existing);
        }
      }

      const additionalContext = [
        seed.audienceHint ? `Audience hint: ${seed.audienceHint}` : null,
        seed.website ? `Site web: ${seed.website}` : null,
        run.adminNotes ? `Notes admin: ${run.adminNotes}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const gen = await MarketingStrategyService.generate({
        organizationId: run.organizationId,
        brandId: run.brandId,
        horizon: (run.horizon as '30d' | '90d' | '12mo') ?? '90d',
        additionalContext: additionalContext || undefined,
      });

      // Même règle que /api/strategy/generate : jamais de stratégie simulée
      // enregistrée comme livrable — l'étape échoue et peut être relancée.
      if (gen.mocked) {
        return {
          success: false,
          reason: gen.mockReason === 'parse_failed'
            ? "L'IA a répondu mais le résultat était inexploitable — relance l'étape."
            : 'Aucun modèle IA disponible — vérifie les clés dans Paramètres → Modèles IA.',
        };
      }

      const saved = await MarketingStrategyService.save({
        organizationId: run.organizationId,
        brandId: run.brandId,
        horizon: run.horizon,
        title: `Stratégie ${run.horizon} — ${seed.name}`,
        strategy: gen.strategy,
        items: gen.items,
        generatedByModel: 'claude',
      });

      const itemStates: Record<string, ItemState> = {};
      for (const it of saved.items) itemStates[it.id] = { status: 'PROPOSED' };

      await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: { strategyId: saved.id, itemStates: itemStates as never },
      });

      await this._appendTrace(pipelineId, {
        kind: 'STRATEGY_GENERATED',
        at: new Date().toISOString(),
        payload: {
          strategyId: saved.id,
          itemCount: saved.items.length,
          mocked: gen.mocked,
        },
      });

      logger.info('BrandPipeline.strategyGenerated', {
        pipelineId,
        strategyId: saved.id,
        itemCount: saved.items.length,
      });
      return {
        success: true,
        data: { strategyId: saved.id, itemCount: saved.items.length },
      };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  /** EXECUTE_ITEMS: loop approved items -> MarketingStrategyService.executeItem. */
  async _performExecuteItems(
    pipelineId: string,
  ): Promise<PipelineResult<{ executed: number; warnings: number }>> {
    try {
      const run = await db.brandPipelineRun.findUnique({ where: { id: pipelineId } });
      if (!run) return { success: false, reason: 'Pipeline run not found' };
      if (!run.strategyId) return { success: false, reason: 'No strategy on pipeline' };

      const states = readItemStates(run);
      const executionLog = readExecutionLog(run);
      const approvedItemIds = Object.entries(states)
        .filter(([, s]) => s.status === 'APPROVED' || s.status === 'EDITED')
        .map(([id]) => id);

      if (approvedItemIds.length === 0) {
        logger.warn('BrandPipeline.executeItems: no approved items', { pipelineId });
      }

      let executed = 0;
      let warningCount = 0;

      for (const itemId of approvedItemIds) {
        try {
          const exec = await MarketingStrategyService.executeItem(
            itemId,
            run.organizationId,
            run.startedById,
          );
          states[itemId] = {
            status: 'EXECUTED',
            warnings: exec.warnings ?? [],
            postId: exec.postId ?? undefined,
            campaignId: exec.campaignId ?? undefined,
            scheduleId: exec.scheduleId ?? undefined,
          };
          executionLog.push({
            itemId,
            postId: exec.postId,
            campaignId: exec.campaignId,
            scheduleId: exec.scheduleId,
            warnings: exec.warnings ?? [],
            at: new Date().toISOString(),
          });
          warningCount += (exec.warnings ?? []).length;
          executed += 1;
          await this._appendTrace(pipelineId, {
            kind: 'ITEM_EXECUTED',
            at: new Date().toISOString(),
            payload: {
              itemId,
              postId: exec.postId,
              campaignId: exec.campaignId,
              scheduleId: exec.scheduleId,
            },
          });
          // Persistance PROGRESSIVE : un timeout serverless au milieu de la
          // boucle perdait TOUT le journal alors que posts et créneaux étaient
          // déjà créés — l'UI ne retrouvait plus rien.
          await db.brandPipelineRun
            .update({
              where: { id: pipelineId },
              data: { itemStates: states as never, executionLog: executionLog as never },
            })
            .catch(() => undefined);
        } catch (err) {
          const reason = (err as Error).message;
          states[itemId] = {
            ...(states[itemId] ?? { status: 'APPROVED' }),
            warnings: [
              ...(states[itemId]?.warnings ?? []),
              `Execution failed: ${reason}`,
            ],
          };
          executionLog.push({ itemId, error: reason, at: new Date().toISOString() });
          await this._appendTrace(pipelineId, {
            kind: 'ERROR',
            at: new Date().toISOString(),
            payload: { itemId, reason },
          });
        }
      }

      await db.brandPipelineRun.update({
        where: { id: pipelineId },
        data: {
          itemStates: states as never,
          executionLog: executionLog as never,
        },
      });

      logger.info('BrandPipeline.executeItems.done', {
        pipelineId,
        executed,
        warningCount,
      });
      return { success: true, data: { executed, warnings: warningCount } };
    } catch (err) {
      return { success: false, reason: (err as Error).message };
    }
  },

  // -------------------- LOW-LEVEL HELPERS --------------------

  async _transition(
    pipelineId: string,
    nextStep: BrandPipelineStep,
  ): Promise<void> {
    await db.brandPipelineRun.update({
      where: { id: pipelineId },
      data: { step: nextStep, status: 'RUNNING' },
    });
    await this._appendTrace(pipelineId, {
      kind: 'STEP_ENTER',
      at: new Date().toISOString(),
      payload: { step: nextStep },
    });
    logger.info('BrandPipeline.transition', { pipelineId, nextStep });
  },

  async _appendTrace(pipelineId: string, ev: PipelineEvent): Promise<void> {
    const run = await db.brandPipelineRun.findUnique({
      where: { id: pipelineId },
      select: { trace: true },
    });
    if (!run) return;
    const current = ((run.trace as unknown) as PipelineEvent[]) ?? [];
    // Cap the trace at 200 most-recent events.
    const next = [...current, ev].slice(-200);
    await db.brandPipelineRun.update({
      where: { id: pipelineId },
      data: { trace: next as never },
    });
  },

  /**
   * Resolve the final redirect URL after pipeline completion.
   * Priority: calendar (if anything scheduled) -> ai-studio (first post) -> brand page.
   */
  async _resolveRedirect(
    run: BrandPipelineRun,
  ): Promise<{ url: string; label: string }> {
    const execLog = readExecutionLog(run);
    const firstSchedule = execLog.find((e) => e.scheduleId);
    if (firstSchedule && run.brandId) {
      return {
        url: `/calendar?brand=${run.brandId}&pipeline=${run.id}`,
        label: 'Voir le calendrier',
      };
    }
    const firstPost = execLog.find((e) => e.postId);
    if (firstPost) {
      return {
        url: `/studio?postId=${firstPost.postId}`,
        label: 'Développer le contenu',
      };
    }
    if (run.brandId) {
      return { url: `/brands/${run.brandId}`, label: 'Voir la marque' };
    }
    return { url: '/brands', label: 'Voir les marques' };
  },
};

export type BrandPipelineServiceType = typeof BrandPipelineService;
