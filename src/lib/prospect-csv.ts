/**
 * Import de prospects depuis un CSV (export Perplexity, tableur maison…) :
 * parseur RFC-4180 (guillemets, virgules internes, CRLF) + mapping d'en-têtes
 * FR/EN tolérant + analyse du lot. Fonctions pures, testées.
 *
 * Exemple réel visé (généré par Perplexity) :
 *   Organisation,Réseau,Type,Zone,Courriel public,Téléphone,Priorité,Note
 */

export interface ImportedProspect {
  name: string;
  organizationName: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  notes: string | null;
}

export interface CsvAnalysis {
  total: number;
  withEmail: number;
  withoutEmail: number;
  /** Lignes ignorées (vides / sans le moindre identifiant). */
  skipped: number;
  /** En-têtes du fichier non reconnues (parties en notes). */
  unmappedHeaders: string[];
}

/** Parseur CSV minimal mais correct : guillemets, `""` échappés, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // BOM Excel
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const fold = (v: string) =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

type FieldKey = keyof ImportedProspect | 'priority' | 'network' | 'orgType';

/** En-tête → champ. Testé sur les exports Perplexity/Apollo/tableurs FR-EN. */
function headerField(header: string): FieldKey | null {
  const h = fold(header);
  if (/courriel|e-?mail|^mail$/.test(h)) return 'email';
  if (/telephone|^tel\b|phone/.test(h)) return 'phone';
  if (/site|website|^web$|^url$/.test(h)) return 'website';
  if (/ville|city|zone|region|localite|secteur geo/.test(h)) return 'city';
  if (/role|titre|title|fonction|poste/.test(h)) return 'role';
  if (/priorite|priority/.test(h)) return 'priority';
  if (/reseau|network/.test(h)) return 'network';
  if (/^type/.test(h)) return 'orgType';
  if (/note|commentaire|comment|remarque/.test(h)) return 'notes';
  if (/organisation|organization|entreprise|societe|company|ecole|etablissement/.test(h)) return 'organizationName';
  if (/nom|name|contact|prospect/.test(h)) return 'name';
  return null;
}

const trimOrNull = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * CSV → prospects prêts à persister + analyse. `name` retombe sur
 * l'organisation quand aucune colonne « nom de personne » n'existe (cas des
 * listes d'organismes). Priorité/Réseau/Type sont conservés dans les notes.
 */
export function mapCsvToProspects(text: string): { prospects: ImportedProspect[]; analysis: CsvAnalysis } {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { prospects: [], analysis: { total: 0, withEmail: 0, withoutEmail: 0, skipped: 0, unmappedHeaders: [] } };
  }
  const headers = rows[0].map((h) => h.trim());
  const fields = headers.map(headerField);
  const unmappedHeaders = headers.filter((_, i) => fields[i] === null && headers[i] !== '');

  const prospects: ImportedProspect[] = [];
  let skipped = 0;
  for (const cells of rows.slice(1)) {
    const rec: Partial<Record<FieldKey, string>> = {};
    const extras: string[] = [];
    cells.forEach((cell, i) => {
      const key = fields[i];
      const v = cell.trim();
      if (!v) return;
      if (key === null) {
        if (headers[i]) extras.push(`${headers[i]}: ${v}`);
        return;
      }
      // Première valeur gagne (deux colonnes « email » = la plus à gauche).
      if (rec[key] === undefined) rec[key] = v;
    });

    const name = trimOrNull(rec.name) ?? trimOrNull(rec.organizationName);
    const email = trimOrNull(rec.email)?.toLowerCase() ?? null;
    if (!name && !email) { skipped++; continue; }

    const noteParts = [
      trimOrNull(rec.priority) ? `Priorité : ${rec.priority}` : null,
      trimOrNull(rec.network) ? `Réseau : ${rec.network}` : null,
      trimOrNull(rec.orgType) ? `Type : ${rec.orgType}` : null,
      trimOrNull(rec.notes),
      ...extras,
    ].filter((v): v is string => !!v);

    prospects.push({
      name: name ?? (email as string),
      organizationName: trimOrNull(rec.organizationName),
      role: trimOrNull(rec.role),
      email: email && email.includes('@') ? email : null,
      phone: trimOrNull(rec.phone),
      website: trimOrNull(rec.website),
      city: trimOrNull(rec.city),
      notes: noteParts.length > 0 ? noteParts.join(' · ') : null,
    });
  }

  const withEmail = prospects.filter((p) => p.email).length;
  return {
    prospects,
    analysis: {
      total: prospects.length,
      withEmail,
      withoutEmail: prospects.length - withEmail,
      skipped,
      unmappedHeaders,
    },
  };
}
