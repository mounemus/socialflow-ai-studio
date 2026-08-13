import { db } from '@/lib/db';

/**
 * Mémoire d'auto-apprentissage stratégique — les recommandations que la marque
 * a RETENUES dans ses propositions (Veille/Concurrents) orientent TOUTES les
 * générations IA : veille, stratégie, emails, prospection assistée.
 *
 * Module séparé pour être importable partout sans dépendance circulaire.
 */
export async function learnedStrategyBlock(organizationId: string, brandId?: string | null): Promise<string> {
  // Best-effort : la mémoire stratégique ENRICHIT les générations, elle ne
  // doit JAMAIS les casser (table absente en test/DB non migrée → bloc vide).
  let learned: Array<{ content: unknown }> = [];
  try {
    learned = await db.watchReport.findMany({
      // Scopé par marque : chaque marque a sa propre mémoire stratégique (les
      // propositions sans marque restent visibles par toutes).
      where: {
        organizationId,
        kind: 'PROPOSAL',
        ...(brandId ? { OR: [{ brandId }, { brandId: null }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { content: true },
    });
  } catch {
    return '';
  }
  const prefs = [
    ...new Set(learned.flatMap((r) => ((r.content as { selected?: string[] } | null)?.selected ?? []))),
  ].slice(0, 12);
  if (prefs.length === 0) return '';
  return (
    `\n\nOrientations stratégiques RETENUES par la marque (mémoire d'auto-apprentissage — respecte-les et appuie-toi dessus) :\n` +
    prefs.map((p) => `- ${p}`).join('\n')
  );
}
