/**
 * Nettoie un texte généré par l'IA pour une publication sociale.
 *
 * Les réseaux (LinkedIn, Instagram, Facebook…) n'interprètent PAS le markdown :
 * un `# POST LINKEDIN — Ma marque`, les séparateurs `---` et les `**gras**`
 * partaient donc tels quels dans le post publié. On retire l'échafaudage
 * rédactionnel tout en préservant le fond, les retours à la ligne et les émojis.
 */
export function sanitizeSocialText(input: string): string {
  if (!input) return '';
  let out = input.replace(/\r\n/g, '\n');

  // En-tête technique du type « # POST LINKEDIN — Marque » / « ## Caption »
  out = out.replace(/^\s*#{1,6}\s*(post|caption|texte|publication)\b[^\n]*\n+/i, '');
  // Variante SANS dièse, souvent préfixée d'un emoji :
  //   « 🎯 Post Facebook — UbSkilled JobHunter »
  // On n'enlève la première ligne que si elle nomme une PLATEFORME : une vraie
  // accroche (« Publication du jour : nos résultats ») est ainsi préservée.
  out = out.replace(
    /^[^\n]{0,140}?\b(post|publication|caption|légende|legende|version|variante)\b[^\n]{0,40}\b(facebook|instagram|linkedin|twitter|x|tiktok|youtube|pinterest)\b[^\n]*\n+/i,
    '',
  );
  // « VERSION INSTAGRAM OPTIMISÉE » et variantes ordre inversé (« INSTAGRAM — version optimisée »)
  out = out.replace(
    /^[^\n]{0,40}\b(facebook|instagram|linkedin|twitter|x|tiktok|youtube|pinterest)\b[^\n]{0,60}\b(optimis[ée]e?|version|variante)\b[^\n]*\n+/i,
    '',
  );
  // Autres titres markdown : on garde le libellé, on retire les dièses.
  out = out.replace(/^\s*#{1,6}\s+/gm, '');
  // Séparateurs horizontaux (---, ***, ___) sur une ligne seule.
  out = out.replace(/^\s*([-*_])\1{2,}\s*$/gm, '');
  // Gras / italique markdown — non rendus par les réseaux.
  out = out.replace(/\*\*(.+?)\*\*/gs, '$1');
  out = out.replace(/__(.+?)__/gs, '$1');
  // Puces markdown « - » ou « * » en début de ligne → puce typographique.
  out = out.replace(/^\s*[-*]\s+/gm, '• ');
  // Clôture de bloc de code éventuelle.
  out = out.replace(/^```.*$/gm, '');
  // Espaces de fin de ligne + plus de 2 sauts de ligne consécutifs.
  out = out.replace(/[ \t]+$/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n');

  return out.trim();
}

/**
 * « Mise en forme » pour réseaux sociaux : les plateformes ne rendent aucun
 * balisage, la seule option est le mapping vers les alphabets mathématiques
 * Unicode (sans-serif bold / sans-serif italic). Les caractères hors A-Z a-z
 * (0-9 pour le gras) sont laissés tels quels — accents compris.
 */
function mapAlphanum(input: string, upper: number, lower: number, digit?: number): string {
  let out = '';
  for (const ch of input) {
    const c = ch.codePointAt(0) as number;
    if (c >= 0x41 && c <= 0x5a) out += String.fromCodePoint(upper + c - 0x41);
    else if (c >= 0x61 && c <= 0x7a) out += String.fromCodePoint(lower + c - 0x61);
    else if (digit !== undefined && c >= 0x30 && c <= 0x39) out += String.fromCodePoint(digit + c - 0x30);
    else out += ch;
  }
  return out;
}

/** abc → 𝗮𝗯𝗰 (Mathematical Sans-Serif Bold, A-Z a-z 0-9). */
export function toUnicodeBold(input: string): string {
  return mapAlphanum(input, 0x1d5d4, 0x1d5ee, 0x1d7ec);
}

/** abc → 𝘢𝘣𝘤 (Mathematical Sans-Serif Italic, A-Z a-z — pas de chiffres italiques). */
export function toUnicodeItalic(input: string): string {
  return mapAlphanum(input, 0x1d608, 0x1d622);
}
