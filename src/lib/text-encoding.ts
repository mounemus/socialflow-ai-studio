/**
 * Réparation du « mojibake » (UTF-8 lu comme Windows-1252) : « livrÃ© dans vos
 * Ã©coles â€" » redevient « livré dans vos écoles — ». Arrive quand un fichier
 * ou un copier-coller a traversé un éditeur en encodage ANSI.
 */

// Caractères 0x80-0x9F de Windows-1252 → octet d'origine.
const CP1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

const MOJIBAKE_MARKER = /â€|Ã[-¿–—€’“”]|Ã©|Ã¨|Ã |Ã§/;

export function looksMojibake(s: string): boolean {
  return MOJIBAKE_MARKER.test(s);
}

/** Répare si le motif mojibake est détecté, sinon renvoie la chaîne telle quelle. */
export function fixMojibake(s: string): string {
  if (!looksMojibake(s)) return s;
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      const byte = code <= 0xff ? code : CP1252_REVERSE[code];
      if (byte === undefined) return s; // caractère hors Windows-1252 : pas du mojibake
      bytes[i] = byte;
    }
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // On n'accepte la réparation que si elle fait disparaître le motif.
    return looksMojibake(repaired) ? s : repaired;
  } catch {
    return s;
  }
}
