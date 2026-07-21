/**
 * AIModelPreferenceService — préférences de modèle par organisation.
 *
 * mode AUTO   → l'orchestrateur décide (routage par tâche + fiabilité observée);
 * mode FORCED → provider + modèle imposés par l'admin (validés contre le
 *               catalogue), avec fallback automatique si le forcé tombe en panne.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { MODEL_CATALOG, findCatalogModel, type ModelCategory } from './model-catalog';

export interface CategoryPreference {
  mode: 'AUTO' | 'FORCED';
  provider: string | null;
  model: string | null;
}

export type OrgModelPreferences = Record<ModelCategory, CategoryPreference>;

const AUTO: CategoryPreference = { mode: 'AUTO', provider: null, model: null };

// Cache court (60 s) — les préférences sont lues à chaque génération.
const cache = new Map<string, { at: number; prefs: OrgModelPreferences }>();

export const AIModelPreferenceService = {
  async forOrg(organizationId: string): Promise<OrgModelPreferences> {
    const hit = cache.get(organizationId);
    if (hit && Date.now() - hit.at < 60_000) return hit.prefs;

    const prefs: OrgModelPreferences = { TEXT: AUTO, IMAGE: AUTO, VIDEO: AUTO };
    try {
      const rows = await db.aIModelPreference.findMany({ where: { organizationId } });
      for (const r of rows) {
        if (r.category === 'TEXT' || r.category === 'IMAGE' || r.category === 'VIDEO') {
          prefs[r.category as ModelCategory] = {
            mode: r.mode === 'FORCED' ? 'FORCED' : 'AUTO',
            provider: r.provider,
            model: r.model,
          };
        }
      }
    } catch (err) {
      // Table absente avant migration → AUTO partout (comportement historique).
      logger.warn('AIModelPreference indisponible — mode AUTO', { err: (err as Error).message });
    }
    cache.set(organizationId, { at: Date.now(), prefs });
    return prefs;
  },

  async set(
    organizationId: string,
    category: ModelCategory,
    pref: CategoryPreference,
  ): Promise<CategoryPreference> {
    if (pref.mode === 'FORCED') {
      if (!pref.provider || !pref.model) {
        throw new Error('mode FORCED: provider et model sont requis');
      }
      if (!findCatalogModel(category, pref.provider, pref.model)) {
        throw new Error(`Modèle inconnu du catalogue: ${pref.provider}/${pref.model} (${category})`);
      }
    }
    await db.aIModelPreference.upsert({
      where: { organizationId_category: { organizationId, category } },
      create: {
        organizationId,
        category,
        mode: pref.mode,
        provider: pref.mode === 'FORCED' ? pref.provider : null,
        model: pref.mode === 'FORCED' ? pref.model : null,
      },
      update: {
        mode: pref.mode,
        provider: pref.mode === 'FORCED' ? pref.provider : null,
        model: pref.mode === 'FORCED' ? pref.model : null,
      },
    });
    cache.delete(organizationId);
    return pref;
  },

  /** Applique la préférence TEXT à un input de génération (mutation légère). */
  applyText<T extends object>(input: T, prefs: OrgModelPreferences): T {
    const i = input as { forceProvider?: string; model?: string };
    if (prefs.TEXT.mode === 'FORCED' && prefs.TEXT.provider) {
      i.forceProvider = prefs.TEXT.provider;
      i.model = prefs.TEXT.model ?? undefined;
    }
    return input;
  },

  applyImage<T extends object>(input: T, prefs: OrgModelPreferences): T {
    const i = input as { forceProvider?: string; model?: string };
    if (prefs.IMAGE.mode === 'FORCED' && prefs.IMAGE.provider) {
      i.forceProvider = prefs.IMAGE.provider;
      i.model = prefs.IMAGE.model ?? undefined;
    }
    return input;
  },

  catalog() {
    return MODEL_CATALOG;
  },
};
