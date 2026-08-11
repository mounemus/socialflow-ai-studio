/**
 * Prospection intelligente — trouve des prospects publics (nom, organisation,
 * email, téléphone, site, ville) via l'API ScrapeGraphAI (search) à partir
 * d'une requête libre ("directions d'écoles primaires à Laval"), les
 * dédoublonne contre l'organisation puis les persiste comme Prospect (NEW).
 *
 * Une seule requête API par recherche (search() avec prompt + schema : la
 * même page fait le crawl web ET l'extraction structurée JSON).
 * Jamais de throw vers l'appelant : clé absente ou erreur → {available:false}.
 */
import { search } from 'scrapegraph-js';
import type { Prospect } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { extractJson } from '@/services/strategy/MarketingStrategyService';

export type ProspectSearchOpts = {
  organizationId: string;
  brandId?: string | null;
  query: string;
  region?: string;
  max?: number;
};

export type ProspectSearchResult =
  | { available: false; reason: string }
  | { available: true; mocked: false; created: number; duplicates: number; prospects: Prospect[] };

type RawProspect = {
  name?: string | null;
  organizationName?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
};

const PROSPECT_SCHEMA = {
  type: 'object',
  properties: {
    prospects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          organizationName: { type: ['string', 'null'] },
          role: { type: ['string', 'null'] },
          email: { type: ['string', 'null'] },
          phone: { type: ['string', 'null'] },
          website: { type: ['string', 'null'] },
          city: { type: ['string', 'null'] },
        },
        required: ['name'],
      },
    },
  },
  required: ['prospects'],
};

function norm(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** Enlève protocole/slash final pour comparer deux sites de façon stable. */
function normWebsite(v: string | null | undefined): string | null {
  const t = norm(v);
  return t ? t.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '') : null;
}

export const ProspectingService = {
  isConfigured(): boolean {
    return !!process.env.SGAI_API_KEY;
  },

  async search(opts: ProspectSearchOpts): Promise<ProspectSearchResult> {
    const apiKey = process.env.SGAI_API_KEY;
    if (!apiKey) {
      return { available: false, reason: "Clé SGAI_API_KEY absente — configure-la sur Vercel puis redéploie." };
    }

    const max = Math.min(Math.max(opts.max ?? 10, 1), 20);
    const region = opts.region?.trim();
    const searchQuery = `${opts.query}${region ? ` ${region}` : ''} coordonnées contact site officiel`.trim();
    const prompt = [
      `Trouve jusqu'à ${max} prospects B2B correspondant à : "${opts.query}"${region ? ` — zone géographique : ${region}` : ''}.`,
      "Utilise UNIQUEMENT des coordonnées PUBLIQUES (site officiel, page \"Contact\", annuaire public). Les adresses email génériques d'organisation (info@, direction@, secretariat@, contact@) sont acceptées et même préférées à une adresse personnelle.",
      "N'invente JAMAIS une information : si un champ est incertain ou introuvable, mets null plutôt que d'inventer.",
      'Réponds strictement en JSON avec cette forme : {"prospects": [{"name": string, "organizationName": string|null, "role": string|null, "email": string|null, "phone": string|null, "website": string|null, "city": string|null}]}',
      `Maximum ${max} entrées dans le tableau.`,
    ].join('\n');

    let raw: RawProspect[] = [];
    try {
      const result = await search(apiKey, {
        query: searchQuery,
        numResults: max,
        prompt,
        schema: PROSPECT_SCHEMA,
      });
      if (result.status !== 'success' || !result.data) {
        logger.warn('ProspectingService.search: échec API', { error: result.error, query: opts.query });
        return { available: false, reason: result.error ?? 'Recherche ScrapeGraphAI indisponible.' };
      }
      const jsonObj = result.data.json as { prospects?: unknown[] } | null | undefined;
      if (jsonObj && Array.isArray(jsonObj.prospects)) {
        raw = jsonObj.prospects as RawProspect[];
      } else {
        const fallback = extractJson<{ prospects?: RawProspect[] }>(result.data.raw);
        raw = fallback?.prospects ?? [];
      }
    } catch (err) {
      logger.warn('ProspectingService.search: exception', { error: (err as Error).message });
      return { available: false, reason: (err as Error).message };
    }

    const cleaned = raw
      .map((p) => ({
        name: norm(p?.name),
        organizationName: norm(p?.organizationName),
        role: norm(p?.role),
        email: norm(p?.email)?.toLowerCase() ?? null,
        phone: norm(p?.phone),
        website: norm(p?.website),
        city: norm(p?.city),
        raw: p,
      }))
      .filter((p): p is typeof p & { name: string } => !!p.name)
      .slice(0, max);

    // ponytail: full scan des prospects de l'org pour dédoublonner — largement
    // suffisant au volume actuel (recherches ponctuelles, dizaines de lignes).
    // Passer à un IN(email/website) ciblé si un org accumule des milliers de prospects.
    const existing = await db.prospect.findMany({
      where: { organizationId: opts.organizationId },
      select: { email: true, website: true },
    });
    const existingEmails = new Set(existing.map((e) => e.email?.toLowerCase()).filter((v): v is string => !!v));
    const existingWebsites = new Set(existing.map((e) => normWebsite(e.website)).filter((v): v is string => !!v));

    let duplicates = 0;
    const created: Prospect[] = [];
    for (const p of cleaned) {
      const websiteNorm = normWebsite(p.website);
      const isDup = (p.email && existingEmails.has(p.email)) || (websiteNorm && existingWebsites.has(websiteNorm));
      if (isDup) {
        duplicates++;
        continue;
      }
      const row = await db.prospect.create({
        data: {
          organizationId: opts.organizationId,
          brandId: opts.brandId ?? null,
          name: p.name,
          organizationName: p.organizationName,
          role: p.role,
          email: p.email,
          phone: p.phone,
          website: p.website,
          city: p.city,
          source: opts.query,
          status: 'NEW',
          rawData: p.raw as never,
        },
      });
      created.push(row);
      if (p.email) existingEmails.add(p.email);
      if (websiteNorm) existingWebsites.add(websiteNorm);
    }

    return { available: true, mocked: false, created: created.length, duplicates, prospects: created };
  },
};
