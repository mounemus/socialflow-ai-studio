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
  /** Filtres — appliqués nativement à Apollo, injectés dans la requête web sinon. */
  titles?: string[];
  seniorities?: string[];
  companySizes?: string[];
  /** Requête alternative pour la source Web (types d'organisations, en français). */
  webQuery?: string;
  /** Mots-clés du secteur des entreprises cibles (en anglais). */
  companyKeywords?: string[];
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

/** Enlève protocole/www/slash final pour comparer deux URLs de façon stable. */
function normWebsite(v: string | null | undefined): string | null {
  const t = norm(v);
  return t ? t.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '') : null;
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
  opts: ProspectSearchOpts,
  perPage: number,
): Promise<{ ok: true; people: RawProspect[] } | { ok: false; reason: string }> {
  const region = opts.region?.trim();
  try {
    const res = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q_keywords: opts.query,
        ...(region ? { person_locations: [region] } : {}),
        ...(opts.titles?.length ? { person_titles: opts.titles } : {}),
        ...(opts.seniorities?.length ? { person_seniorities: opts.seniorities } : {}),
        ...(opts.companySizes?.length ? { organization_num_employees_ranges: opts.companySizes } : {}),
        page: 1,
        per_page: perPage,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { people?: ApolloPerson[]; error_code?: string };
    if (!res.ok) {
      // Constaté : le plan gratuit Apollo bloque l'API de recherche (403 API_INACCESSIBLE).
      if (json.error_code === 'API_INACCESSIBLE') {
        return { ok: false, reason: "le plan gratuit Apollo n'inclut pas l'API de recherche — passe à un plan payant (apollo.io/pricing) ou utilise la source Web" };
      }
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

type ApifyLead = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  personCity?: string;
  personState?: string;
  personCountry?: string;
  companyName?: string;
  companyDomain?: string;
};

const APIFY_ACTOR = 'pipelinelabs~lead-scraper-apollo-zoominfo-lusha-ppe';

/**
 * Source « LinkedIn » économique — acteur Apify « Leads Scraper » (~1 $/1000
 * leads AVEC emails, 5 $ de crédits gratuits/mois). Utilisé quand l'API Apollo
 * n'est pas accessible (plan gratuit). Schéma d'entrée vérifié le 2026-08-11.
 */
/** minuscules + sans accents, pour comparer « Québec » et « Quebec ». */
function fold(v: string | null | undefined): string {
  return (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Corps de requête commun à la recherche et à l'estimation (countOnly). */
function buildApifyInput(opts: ProspectSearchOpts): { input: Record<string, unknown>; regionParts: string[]; country: string | null } {
  // L'acteur valide les pays sur une liste fermée en anglais — on mappe les
  // libellés FR courants ; les villes restent du texte libre (toutes les
  // parties de la zone qui ne sont pas un pays).
  const COUNTRIES: Record<string, string> = {
    canada: 'Canada', 'québec': 'Canada', quebec: 'Canada', ontario: 'Canada',
    france: 'France', belgique: 'Belgium', suisse: 'Switzerland',
    'états-unis': 'United States', 'etats-unis': 'United States', usa: 'United States',
    maroc: 'Morocco', tunisie: 'Tunisia',
  };
  const parts = (opts.region ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const country = parts.map((p) => COUNTRIES[fold(p)]).find(Boolean) ?? null;
  const cities = parts.filter((p) => !COUNTRIES[fold(p)] && !['québec', 'quebec', 'ontario'].includes(fold(p)));
  const ACTOR_SENIORITIES = new Set(['c_suite', 'vp', 'director', 'manager', 'senior', 'entry', 'owner', 'partner', 'intern']);
  const seniorities = (opts.seniorities ?? []).filter((s) => ACTOR_SENIORITIES.has(s));
  const companyKeywords = (opts.companyKeywords ?? []).map((k) => k.trim()).filter(Boolean);
  return {
    regionParts: parts,
    country,
    input: {
      personTitleIncludes: opts.titles?.length ? opts.titles : [opts.query],
      includeTitleVariants: true,
      roleMatchMode: 'any',
      hasEmail: true,
      ...(seniorities.length ? { seniorityIncludes: seniorities } : {}),
      ...(opts.companySizes?.length
        ? { companySizeIncludes: opts.companySizes.map((s) => s.replace(',', '-')) }
        : {}),
      ...(companyKeywords.length ? { companyKeywordIncludes: companyKeywords } : {}),
      ...(cities.length ? { personLocationCityIncludes: cities } : {}),
      ...(country ? { personLocationCountryIncludes: [country] } : {}),
    },
  };
}

async function apifyLeadSearch(
  token: string,
  opts: ProspectSearchOpts,
  total: number,
): Promise<{ ok: true; people: RawProspect[] } | { ok: false; reason: string }> {
  const { input, regionParts, country } = buildApifyInput(opts);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=100`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalResults: total, ...input }),
      },
    );
    const items = (await res.json().catch(() => null)) as ApifyLead[] | null;
    if (!res.ok || !Array.isArray(items)) {
      return { ok: false, reason: `Apify HTTP ${res.status} — ${JSON.stringify(items).slice(0, 160)}` };
    }
    // Garantie géographique : l'acteur peut être flou — on ne garde que les
    // leads dont ville/province/pays recoupe la zone demandée.
    const wanted = [...regionParts, ...(country ? [country] : [])].map(fold);
    const inRegion = (p: ApifyLead & { personState?: string; personCountry?: string }) => {
      if (wanted.length === 0) return true;
      const fields = [p.personCity, p.personState, p.personCountry].map(fold).filter(Boolean);
      if (fields.length === 0) return true;
      return fields.some((f) => wanted.some((w) => f === w || f.includes(w) || w.includes(f)));
    };
    return {
      ok: true,
      people: items.filter(inRegion).map((p) => ({
        name: norm(p.fullName) ?? norm([p.firstName, p.lastName].filter(Boolean).join(' ')),
        organizationName: norm(p.companyName),
        role: norm(p.title),
        email: p.email && p.email.includes('@') ? p.email.toLowerCase() : null,
        phone: norm(p.phone),
        website: norm(p.companyDomain),
        city: norm(p.personCity),
        linkedinUrl: norm(p.linkedinUrl),
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
    return {
      web: !!process.env.SGAI_API_KEY,
      linkedin: !!process.env.APOLLO_API_KEY || !!process.env.APIFY_API_TOKEN,
    };
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

  /**
   * Estimation GRATUITE du volume de leads LinkedIn correspondant aux filtres
   * (mode countOnly de l'acteur Apify — « without any charge »).
   */
  async estimate(opts: ProspectSearchOpts): Promise<{ ok: false; reason: string } | { ok: true; count: number }> {
    const token = process.env.APIFY_API_TOKEN?.trim();
    if (!token) return { ok: false, reason: "Estimation disponible avec la source LinkedIn (APIFY_API_TOKEN) uniquement." };
    const { input } = buildApifyInput(opts);
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=60`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ countOnly: true, ...input }),
        },
      );
      const items = (await res.json().catch(() => null)) as Array<{ count?: number }> | null;
      const count = Array.isArray(items) ? items[0]?.count : undefined;
      if (!res.ok || typeof count !== 'number') {
        return { ok: false, reason: `Estimation impossible (HTTP ${res.status}).` };
      }
      return { ok: true, count };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },

  async search(opts: ProspectSearchOpts): Promise<ProspectSearchResult> {
    const source = opts.source ?? 'auto';
    // .trim() : une valeur collée avec un retour à la ligne (CLI/copier-coller)
    // devient sinon un token invalide → 401 silencieux.
    const apolloKey = process.env.APOLLO_API_KEY?.trim();
    const apifyToken = process.env.APIFY_API_TOKEN?.trim();
    const apiKey = process.env.SGAI_API_KEY?.trim();
    const max = Math.min(Math.max(opts.max ?? 3, 1), 10);
    const region = opts.region?.trim();

    // --- Source LinkedIn : Apollo (si plan payant) puis acteur Apify (~1 $/1000
    // leads, crédits gratuits mensuels), prioritaire en mode auto si configurée.
    if (source !== 'web' && (apolloKey || apifyToken)) {
      const attempts: string[] = [];
      let people: RawProspect[] = [];
      if (apolloKey) {
        const res = await apolloPeopleSearch(apolloKey, opts, Math.max(max, 10));
        if (res.ok && res.people.length > 0) people = res.people;
        else attempts.push(`Apollo : ${res.ok ? 'aucun résultat' : res.reason}`);
      }
      if (people.length === 0 && apifyToken) {
        // Coût maîtrisé : 10-25 leads max par recherche (≈0,01-0,025 $).
        const res = await apifyLeadSearch(apifyToken, opts, Math.min(Math.max(max, 10), 25));
        if (res.ok && res.people.length > 0) people = res.people;
        else attempts.push(`Apify : ${res.ok ? 'aucun résultat' : res.reason}`);
      }
      if (people.length > 0) return this.persist(people, opts, 'linkedin');
      if (source === 'linkedin') {
        return { available: false, reason: `Recherche LinkedIn sans résultat (${attempts.join(' ; ')}). Essaie une cible en anglais (ex. « school principal ») ou la source « Web ».` };
      }
      logger.warn('ProspectingService: LinkedIn sans résultat, bascule sur le web', { attempts });
    }
    if (source === 'linkedin' && !apolloKey && !apifyToken) {
      return { available: false, reason: 'Aucune clé LinkedIn — ajoute APIFY_API_TOKEN (apify.com, 5 $ gratuits/mois) ou APOLLO_API_KEY (plan payant) sur Vercel puis redéploie.' };
    }
    if (!apiKey) {
      return { available: false, reason: "Clé SGAI_API_KEY absente — configure-la sur Vercel puis redéploie." };
    }

    // --- Étape 1 : organisations + sites officiels (Gemini + Google Search).
    let orgs: Array<{ organizationName: string; website: string | null }> = [];
    let sources: Array<{ uri: string; title: string }> = [];
    try {
      const filterHints = [
        opts.titles?.length ? `Rôles visés : ${opts.titles.join(', ')}.` : '',
        opts.companySizes?.length ? `Taille d'organisation (employés) : ${opts.companySizes.join(' ou ')}.` : '',
      ].filter(Boolean).join(' ');
      const webTarget = opts.webQuery?.trim() || opts.query;
      const grounded = await GeminiService.groundedResearch({
        query:
          `Trouve jusqu'à ${max} organisations RÉELLES correspondant à « ${webTarget} »` +
          `${region ? ` dans la zone « ${region} »` : ''}. ${filterHints} ` +
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
      select: { email: true, website: true, rawData: true },
    });
    const existingEmails = new Set(existing.map((e) => e.email?.toLowerCase()).filter((v): v is string => !!v));
    const existingWebsites = new Set(existing.map((e) => normWebsite(e.website)).filter((v): v is string => !!v));
    const existingLinkedins = new Set(
      existing
        .map((e) => normWebsite((e.rawData as { linkedinUrl?: string } | null)?.linkedinUrl))
        .filter((v): v is string => !!v),
    );

    let duplicates = 0;
    const created: Prospect[] = [];
    for (const p of cleaned) {
      const websiteNorm = normWebsite(p.website);
      const linkedinNorm = normWebsite((p.raw as RawProspect).linkedinUrl);
      // Un email ou un profil LinkedIn identique est toujours un doublon ; un
      // site identique n'est un doublon que sans email nouveau.
      const isDup =
        (p.email && existingEmails.has(p.email)) ||
        (linkedinNorm && existingLinkedins.has(linkedinNorm)) ||
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
      if (linkedinNorm) existingLinkedins.add(linkedinNorm);
    }

    return { available: true, mocked: false, provider, created: created.length, duplicates, prospects: created };
  },
};
