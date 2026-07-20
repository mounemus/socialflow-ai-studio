import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

/**
 * GET  /api/posts/[id]/versions            — historique du contenu
 * POST /api/posts/[id]/versions {version}  — restaurer une version
 * La restauration snapshotte d'abord l'état courant (rien n'est perdu).
 */
export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  await resolvePostContext(id);
  const versions = await db.postVersion.findMany({
    where: { postId: id },
    orderBy: { version: 'desc' },
    take: 50,
  });
  return ok(versions);
});

const restoreSchema = z.object({ version: z.number().int().positive() });

export const POST = handle(async (req, { params }) => {
  const { id } = await params;
  const { role, userId, post } = await resolvePostContext(id);
  requirePermission(role, 'post.edit');
  const { version } = restoreSchema.parse(await req.json());

  const snapshot = await db.postVersion.findUnique({
    where: { postId_version: { postId: id, version } },
  });
  if (!snapshot) throw new NotFoundError(`Version ${version} introuvable`);

  // Snapshot de l'état courant avant restauration.
  await db.postVersion.upsert({
    where: { postId_version: { postId: id, version: post.version } },
    create: {
      postId: id,
      version: post.version,
      title: post.title,
      body: post.body,
      hashtags: post.hashtags,
      cta: post.cta,
      note: `avant restauration v${version}`,
      createdById: userId,
    },
    update: {},
  });

  const updated = await db.post.update({
    where: { id },
    data: {
      title: snapshot.title,
      body: snapshot.body,
      hashtags: snapshot.hashtags,
      cta: snapshot.cta,
      version: { increment: 1 },
    },
  });
  return ok({ restoredFrom: version, post: updated });
});
