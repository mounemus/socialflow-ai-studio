import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolvePostContext } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { resolvePostPlatform } from '@/lib/post-platform';

const patchSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().optional(),
  linkUrl: z.string().url().optional().nullable(),
  status: z.string().optional(),
  // Même validation lâche que POST /api/posts — Prisma rejette les valeurs hors enum.
  format: z.string().optional(),
  // Shallow-merged into the existing metadata JSON column. Whitelisted keys only —
  // anything else is silently dropped to avoid clients writing arbitrary state.
  metadata: z
    .object({
      coverMediaId: z.string().optional(),
      coverUrl: z.string().optional(),
    })
    .partial()
    .optional(),
});

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  await resolvePostContext(id);
  const post = await db.post.findUnique({
    where: { id },
    include: { brand: true, campaign: true, schedules: true, media: true, canvaDesigns: true, variants: true, approvals: true },
  });
  if (!post) return ok(post);
  // `resolvedPlatform` : la plateforme réelle du post, y compris pour les
  // formats transverses (AD_VISUAL, EMAIL_MARKETING…) dont le `format`
  // n'encode aucune plateforme — l'UI l'affiche et s'en sert pour publier.
  const resolvedPlatform = await resolvePostPlatform(post);
  return ok({ ...post, resolvedPlatform });
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const { role, userId } = await resolvePostContext(id);
  requirePermission(role, 'post.edit');
  const body = patchSchema.parse(await req.json());
  const data: Record<string, unknown> = { ...body, version: { increment: 1 } };
  if (body.status) data.status = body.status as never;

  const existing = await db.post.findUnique({
    where: { id },
    select: { metadata: true, title: true, body: true, hashtags: true, cta: true, version: true },
  });

  if (body.metadata) {
    // Shallow-merge into existing metadata JSON column.
    const merged = {
      ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
      ...body.metadata,
    };
    data.metadata = merged as never;
  }

  // Historique: snapshot du contenu AVANT toute modification de fond, pour
  // que l'atelier puisse comparer et restaurer.
  const touchesContent =
    body.title !== undefined || body.body !== undefined ||
    body.hashtags !== undefined || body.cta !== undefined;
  if (touchesContent && existing) {
    await db.postVersion
      .upsert({
        where: { postId_version: { postId: id, version: existing.version } },
        create: {
          postId: id,
          version: existing.version,
          title: existing.title,
          body: existing.body,
          hashtags: existing.hashtags,
          cta: existing.cta,
          note: 'edit',
          createdById: userId,
        },
        update: {},
      })
      .catch(() => undefined); // table absente tant que la DB n'est pas migrée — non bloquant
  }

  const updated = await db.post.update({
    where: { id },
    data: data as never,
  });
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const { role } = await resolvePostContext(id);
  requirePermission(role, 'post.delete');
  await db.post.delete({ where: { id } });
  return ok({ deleted: true });
});
