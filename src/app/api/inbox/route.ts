import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { handle, ok } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { db } from '@/lib/db';

const querySchema = z.object({
  status: z.string().optional(),
  sentiment: z.string().optional(),
  platform: z.string().optional(),
  brandId: z.string().optional(),
  assignedToId: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const q = querySchema.parse({
    status: url.searchParams.get('status') ?? undefined,
    sentiment: url.searchParams.get('sentiment') ?? undefined,
    platform: url.searchParams.get('platform') ?? undefined,
    brandId: url.searchParams.get('brandId') ?? undefined,
    assignedToId: url.searchParams.get('assignedToId') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });

  // Scope marque active (cookie) — un brandId explicite dans la query prime.
  // Les interactions sans marque restent visibles. Enveloppé dans AND pour ne
  // pas entrer en collision avec le OR du filtre search.
  const activeBrandId = q.brandId ? null : await getActiveBrandId(ctx.organizationId);
  const brandScope: Prisma.SocialInteractionWhereInput = q.brandId
    ? { brandId: q.brandId }
    : activeBrandId
      ? { AND: [{ OR: [{ brandId: activeBrandId }, { brandId: null }] }] }
      : {};

  const where: Prisma.SocialInteractionWhereInput = {
    organizationId: ctx.organizationId,
    ...brandScope,
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.sentiment ? { sentiment: q.sentiment as never } : {}),
    ...(q.platform ? { platform: q.platform as never } : {}),
    ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
    ...(q.search
      ? {
          OR: [
            { content: { contains: q.search, mode: 'insensitive' } },
            { fromHandle: { contains: q.search, mode: 'insensitive' } },
            { fromName: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [interactions, total, unread] = await Promise.all([
    db.socialInteraction.findMany({
      where,
      // Route pollée toutes les 30 s : on ne transporte ni `rawData` ni le
      // Post complet (body + metadata) — l'UI n'affiche que des libellés.
      omit: { rawData: true },
      include: {
        brand: { select: { id: true, name: true } },
        socialAccount: { select: { id: true, platform: true, handle: true, displayName: true } },
        post: { select: { id: true, title: true } },
        assignedTo: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { receivedAt: 'desc' },
      take: q.limit,
      skip: q.offset,
    }),
    db.socialInteraction.count({ where }),
    db.socialInteraction.count({
      // Même scope marque que la liste — le compteur doit rester cohérent.
      where: { organizationId: ctx.organizationId, ...brandScope, status: 'NEW' as never },
    }),
  ]);

  return ok({ interactions, total, unread });
});
