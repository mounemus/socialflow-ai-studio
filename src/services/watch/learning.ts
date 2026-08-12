import { db } from '@/lib/db';

/**
 * Mémoire d'auto-apprentissage stratégique — les recommandations que la marque
 * a RETENUES dans ses propositions (Veille/Concurrents) orientent TOUTES les
 * générations IA : veille, stratégie, emails, prospection assistée.
 *
 * Module séparé pour être importable partout sans dépendance circulaire.
 */
export async function learnedStrategyBlock(organizationId: string): Promise<string> {
  const learned = await db.watchReport.findMany({
    where: { organizationId, kind: 'PROPOSAL' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { content: true },
  });
  const prefs = [
    ...new Set(learned.flatMap((r) => ((r.content as { selected?: string[] } | null)?.selected ?? []))),
  ].slice(0, 12);
  if (prefs.length === 0) return '';
  return (
    `\n\nOrientations stratégiques RETENUES par la marque (mémoire d'auto-apprentissage — respecte-les et appuie-toi dessus) :\n` +
    prefs.map((p) => `- ${p}`).join('\n')
  );
}
