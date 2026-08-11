/**
 * Prospection intelligente — deux sources sélectionnables (auto par défaut) :
 *
 *   A. « linkedin » — Apollo.io People Search (API officielle, palier gratuit),
 *      données LinkedIn fiables et économiques post-Proxycurl.
 *   B. « web » — pipeline en deux étapes contrôlées :
 *
 *   1. Gemini + Google Search (groundedResearch, déjà configuré) trouve les
 *      organisations réelles correspondant à la cible + leur site officiel.
 *   2. ScrapeGraphAI `smartscraper` (endpoint CŒUR et stable de l'API v1)
 *      extrait les contacts publics de chaque site — c'est exactement ce que
 *      fait leur `searchscraper` en interne, mais ce dernier renvoie des 500
 *      systématiques (constaté en prod) : on le contourne définitivement.
 *
 * Coût maîtrisé : 1 appel Gemini + 1 smartscraper (≈10 crédits) PAR SITE.
 * Un site en échec est conservé comme prospect minimal (nom + site) — la
 * recherche ne rate jamais complètement à cause d'un seul site.
 * Jamais de throw vers l'appelant : clé absente ou échec → {available:false}.
 */
import type { Prospect } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { GeminiService } from '@/services/ai/GeminiService';
import { extractJson } from '@/services/strategy/MarketingStrategyService';

export type ProspectSource = 'auto' | 'linkedin' | 'web';

export type ProspectSearchOpts = {
  organizationId: string;
  brandId?: string | null;
  query: string;
  region?: string;
  max?: number;
  source?: ProspectSource;
};

export type ProspectSearchResult =
  | { available: false; reason: string }
  | {
      available: true;
      mocked: false;
      provider: 'linkedin' | 'web';
      created: number;
      duplicates: number;
      prospects: Prospect[];
    };

type RawProspect = {
  name?: string | null;
  organizationName?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  linkedinUrl?: string | null;
};

const CONTACT_SCHEMA = {
  type: 'object',
  properties: {
    contacts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'] },
          role: { type: ['string', 'null'] },
          email: { type: ['string', 'null'] },
          phone: { type: ['string', 'null'] },
          city: { type: ['string', 'null'] },
        },
      },
    },
  },
  required: ['contacts'],
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

/** Cherche récursivement un tableau d'objets sous la clé donnée. */
function findArrayByKey(value: unknown, key: string, depth = 0): Record<string, unknown>[] | null {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  if (Array.isArray(value)) {
    const objs = value.filter((v) => v && typeof v === 'object');
    return objs.length > 0 ? (objs as Record<string, unknown>[]) : null;
  }
  const rec = value as Record<string, unknown>;
  if (Array.isArray(rec[key])) return findArrayByKey(rec[key], key, depth + 1);
  for (const v of Object.values(rec)) {
    const found = findArrayByKey(v, key, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Appel API v1 générique (header SGAI-APIKEY) avec gestion de la file
 * d'attente : si la réponse porte un request_id en cours, on poll jusqu'à
 * ~60 s. Un 5xx isolé est retenté une fois.
 */
async function v1Request(
  apiKey: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; reason: string }> {
  const base = 'https://api.scrapegraphai.com/v1';
  const headers = { 'SGAI-APIKEY': apiKey, 'Content-Type': 'application/json' };
  try {
    let res = await fetch(`${base}/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 3000));
      res = await fetch(`${base}/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
    }
    let json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status} — ${JSON.stringify(json).slice(0, 160)}` };
    }
    const requestId = typeof json.request_id === 'string' ? json.request_id : null;
    let status = typeof json.status === 'string' ? json.status : 'completed';
    const deadline = Date.now() + 60_000;
    while (requestId && ['queued', 'processing', 'pending'].includes(status) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));
      const poll = await fetch(`${base}/${endpoint}/${encodeURIComponent(requestId)}`, { headers });
      json = (await poll.json().catch(() => ({}))) as Record<string, unknown>;
      status = typeof json.status === 'string' ? json.status : 'completed';
    }
    if (['queued', 'processing', 'pending', 'failed'].includes(status)) {
      return { ok: false, reason: `statut final « ${status} »` };
    }
    return { ok: true, json };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/** Étape 2 — contacts publics d'un site via smartscraper. */
async function extractContactsFromSite(
  apiKey: string,
  websiteUrl: string,
): Promise<{ ok: true; contacts: RawProspect[] } | { ok: false; reason: string }> {
  const url = /^https?:\/\//.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
  const res = await v1Request(apiKey, 'smartscraper', {
    website_url: url,
    user_prompt:
      "Extrais les contacts PUBLICS de cette organisation (page contact, équipe, direction) : nom de la personne ou du service, rôle, email, téléphone, ville. Les emails génériques (info@, direction@, secretariat@) sont acceptés. Ne rien inventer : champ introuvable = null.",
    output_schema: CONTACT_SCHEMA,
  });
  if (!res.ok) return res;
  const contacts =
    findArrayByKey(res.json.result ?? res.json, 'contacts') ??
    extractJson<{ contacts?: RawProspect[] }>(JSON.stringify(res.json.result ?? res.json))?.contacts ??
    [];
  return { ok: true, contacts: contacts as RawProspect[] };
}

type ApolloPerson = {
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  organization?: { name?: string; website_url?: string; primary_domain?: string };
};

/**
 * Source « LinkedIn » — API officielle Apollo.io (People Search), le fournisseur
 * de données LinkedIn le plus économique et fiable depuis la fermeture de
 * Proxycurl (poursuite LinkedIn, 2025). Palier gratuit disponible.
 * Les emails verrouillés du plan gratuit (email_not_unlocked@…) sont ignorés —
 * le bouton « Enrichir » existant les retrouve gratuitement via Gemini.
 */
async function apolloPeopleSearch(
  apiKey: string,
  query: string,
  region: string | undefined,
  perPage: number,
): Promise<{ ok: true; people: RawProspect[] } | { ok: false; reason: string }> {
  try {
    const res = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q_keywords: query,
        ...(region ? { person_locations: [region] } : {}),
        page: 1,
        per_page: perPage,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { people?: ApolloPerson[] };
    if (!res.ok) {
      return { ok: false, reason: `Apollo HTTP ${res.status} — ${JSON.stringify(json).slice(0, 160)}` };
    }
    const people = Array.isArray(json.people) ? json.people : [];
    return {
      ok: true,
      people: people.map((p) => ({
        name: norm(p.name) ?? norm([p.first_name, p.last_name].filter(Boolean).join(' ')),
        organizationName: norm(p.organization?.name),
        role: norm(p.title),
        email:
          p.email && p.email.includes('@') && !p.email.startsWith('email_not_unlocked')
            ? p.email.toLowerCase()
            : null,
        website: norm(p.organization?.website_url) ?? norm(p.organization?.primary_domain),
        city: norm([p.city, p.state].filter(Boolean).join(', ')),
        linkedinUrl: norm(p.linkedin_url),
      })),
    };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export type ProspectEnrichResult =
  | { ok: false; reason: string }
  | { ok: true; prospect: Prospect; found: { email: boolean; phone: boolean; city: boolean }; creditsUsed: number };

export const ProspectingService = {
  isConfigured(): boolean {
    return !!process.env.SGAI_API_KEY || !!process.env.APOLLO_API_KEY;
  },

  /** Fournisseurs disponibles selon les clés configurées (affiché dans l'UI). */
  providers(): { web: boolean; linkedin: boolean } {
    return { web: !!process.env.SGAI_API_KEY, linkedin: !!process.env.APOLLO_API_KEY };
  },

  /**
   * Enrichit UN prospect à la demande, en économisant les crédits :
   *   1. Gemini + Google Search (gratuit) cherche email/téléphone publics et
   *      l'URL de la page contact de l'organisation.
   *   2. smartscraper (10 crédits) UNIQUEMENT si l'email manque encore —
   *      sur la page contact identifiée, sinon la page d'accueil.
   */
  async enrich(prospectId: string, organizationId: string): Promise<ProspectEnrichResult> {
    const prospect = await db.prospect.findFirst({ where: { id: prospectId, organizationId } });
    if (!prospect) return { ok: false, reason: 'Prospect introuvable.' };

    const target = prospect.organizationName ?? prospect.name;
    let email = prospect.email;
    let phone = prospect.phone;
    let city = prospect.city;
    let contactPage: string | null = null;
    let creditsUsed = 0;

    // --- 1. Recherche web gratuite (Gemini + Google Search).
    try {
      const grounded = await GeminiService.groundedResearch({
        query:
          `Coordonnées publiques de contact de « ${target} »` +
          `${prospect.website ? ` (site : ${prospect.website})` : ''}${prospect.city ? `, ${prospect.city}` : ''}. ` +
          'Donne : email public de contact (générique accepté : info@, direction@…), téléphone, ville, et URL exacte de la page contact / « Nous joindre ». ' +
          'Ne rien inventer — champ introuvable = null. ' +
          'Réponds UNIQUEMENT en JSON strict : {"email": string|null, "phone": string|null, "city": string|null, "contactPageUrl": string|null}',
        maxResults: 5,
      });
      const parsed = extractJson<{ email?: string | null; phone?: string | null; city?: string | null; contactPageUrl?: string | null }>(grounded.text);
      email = email ?? norm(parsed?.email)?.toLowerCase() ?? null;
      phone = phone ?? norm(parsed?.phone);
      city = city ?? norm(parsed?.city);
      contactPage = norm(parsed?.contactPageUrl);
    } catch (err) {
      logger.warn('ProspectingService.enrich: recherche Gemini échouée', { error: (err as Error).message });
    }

    // --- 2. Scraping ciblé seulement si l'email manque encore.
    const apiKey = process.env.SGAI_API_KEY;
    if (!email && apiKey && (contactPage || prospect.website)) {
      const extraction = await extractContactsFromSite(apiKey, contactPage ?? (prospect.website as string));
      creditsUsed = 10;
      if (extraction.ok) {
        const withEmail = extraction.contacts.find((c) => norm(c.email));
        const first = withEmail ?? extraction.contacts[0];
        if (first) {
          email = email ?? norm(withEmail?.email)?.toLowerCase() ?? null;
          phone = phone ?? norm(first.phone);
          city = city ?? norm(first.city);
        }
      } else {
        logger.warn('ProspectingService.enrich: scraping échoué', { prospectId, reason: extraction.reason });
      }
    }

    const updated = await db.prospect.update({
      where: { id: prospect.id },
      data: {
        email,
        phone,
        city,
        rawData: {
          ...((prospect.rawData as Record<string, unknown>) ?? {}),
          enrichedAt: new Date().toISOString(),
          contactPage,
        } as never,
      },
    });

    return {
      ok: true,
      prospect: updated,
      found: { email: !!email && !prospect.email, phone: !!phone && !prospect.phone, city: !!city && !prospect.city },
      creditsUsed,
    };
  },

  async search(opts: ProspectSearchOpts): Promise<ProspectSearchResult> {
    const source = opts.source ?? 'auto';
    const apolloKey = process.env.APOLLO_API_KEY;
    const apiKey = process.env.SGAI_API_KEY;
    const max = Math.min(Math.max(opts.max ?? 3, 1), 10);
    const region = opts.region?.trim();

    // --- Source LinkedIn (Apollo.io) : prioritaire en mode auto si configurée.
    if (source !== 'web' && apolloKey) {
      const res = await apolloPeopleSearch(apolloKey, opts.query, region, Math.max(max, 10));
      if (res.ok && res.people.length > 0) {
        return this.persist(res.people, opts, 'linkedin');
      }
      const reason = res.ok ? 'aucun résultat' : res.reason;
      if (source === 'linkedin') {
        return { available: false, reason: `Recherche LinkedIn (Apollo) : ${reason}. Essaie la source « Web » ou reformule la cible en anglais (ex. « school principal »).` };
      }
      logger.warn('ProspectingService: Apollo sans résultat, bascule sur le web', { reason });
    }
    if (source === 'linkedin' && !apolloKey) {
      return { available: false, reason: 'Clé APOLLO_API_KEY absente — crée un compte gratuit sur apollo.io, ajoute la clé sur Vercel puis redéploie.' };
    }
    if (!apiKey) {
      return { available: false, reason: "Clé SGAI_API_KEY absente — configure-la sur Vercel puis redéploie." };
    }

    // --- Étape 1 : organisations + sites officiels (Gemini + Google Search).
    let orgs: Array<{ organizationName: string; website: string | null }> = [];
    let sources: Array<{ uri: string; title: string }> = [];
    try {
      const grounded = await GeminiService.groundedResearch({
        query:
          `Trouve jusqu'à ${max} organisations RÉELLES correspondant à « ${opts.query} »` +
          `${region ? ` dans la zone « ${region} »` : ''}. ` +
          'Pour chacune : nom exact et site web officiel. ' +
          'Réponds UNIQUEMENT en JSON strict : {"organizations":[{"organizationName":"...","website":"https://..."}]}',
        maxResults: max,
      });
      sources = grounded.sources;
      const parsed = extractJson<{ organizations?: Array<{ organizationName?: string; website?: string }> }>(
        grounded.text,
      )?.organizations ?? [];
      orgs = parsed
        .map((o) => ({ organizationName: norm(o.organizationName) ?? '', website: norm(o.website) }))
        .filter((o) => o.organizationName);
    } catch (err) {
      logger.warn('ProspectingService: recherche Gemini échouée', { error: (err as Error).message });
    }
    // Secours : les sources citées par la recherche elle-même.
    if (orgs.length === 0 && sources.length > 0) {
      orgs = sources.slice(0, max).map((s) => ({ organizationName: s.title, website: s.uri }));
    }
    if (orgs.length === 0) {
      return {
        available: false,
        reason: 'Recherche web sans résultat exploitable — précise la cible et la zone (ex. « écoles primaires » / « Laval, Québec »).',
      };
    }

    // --- Étape 2 : extraction des contacts site par site (smartscraper).
    const raw: RawProspect[] = [];
    const siteFailures: string[] = [];
    for (const org of orgs.slice(0, max)) {
      if (!org.website) {
        raw.push({ name: org.organizationName, organizationName: org.organizationName });
        continue;
      }
      const extraction = await extractContactsFromSite(apiKey, org.website);
      if (!extraction.ok) {
        siteFailures.push(`${org.organizationName}: ${extraction.reason}`);
        // Prospect minimal — le site en échec reste actionnable à la main.
        raw.push({ name: org.organizationName, organizationName: org.organizationName, website: org.website });
        continue;
      }
      const contacts = extraction.contacts.filter((c) => norm(c.email) || norm(c.phone) || norm(c.name));
      if (contacts.length === 0) {
        raw.push({ name: org.organizationName, organizationName: org.organizationName, website: org.website });
        continue;
      }
      for (const c of contacts.slice(0, 5)) {
        raw.push({
          name: norm(c.name) ?? org.organizationName,
          organizationName: org.organizationName,
          role: c.role,
          email: c.email,
          phone: c.phone,
          website: org.website,
          city: c.city,
        });
      }
    }
    if (siteFailures.length > 0) {
      logger.warn('ProspectingService: extractions partielles', { siteFailures });
    }

    return this.persist(raw, opts, 'web');
  },

  /** Nettoyage + dédoublonnage + insertion en base — commun à toutes les sources. */
  async persist(
    raw: RawProspect[],
    opts: ProspectSearchOpts,
    provider: 'linkedin' | 'web',
  ): Promise<ProspectSearchResult> {
    const cleaned = raw
      .map((p) => ({
        name: norm(p?.name),
        organizationName: norm(p?.organizationName),
        role: norm(p?.role),
        email: norm(p?.email)?.toLowerCase() ?? null,
        phone: norm(p?.phone),
        website: norm(p?.website),
        city: norm(p?.city),
        raw: { ...p, provider },
      }))
      .filter((p): p is typeof p & { name: string } => !!p.name)
      // `max` = nombre de SITES analysés (coût API) — un site peut livrer
      // plusieurs contacts : on garde jusqu'à 20 prospects par recherche.
      .slice(0, 20);

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
      // Un email identique est toujours un doublon ; un site identique n'est
      // un doublon que si le prospect n'apporte pas un email nouveau.
      const isDup =
        (p.email && existingEmails.has(p.email)) ||
        (!p.email && websiteNorm && existingWebsites.has(websiteNorm));
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

    return { available: true, mocked: false, provider, created: created.length, duplicates, prospects: created };
  },
};
