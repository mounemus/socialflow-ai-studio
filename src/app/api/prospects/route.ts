import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const STATUSES = ['NEW', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'DISCARDED'] as const;

/** GET /api/prospects — prospects de l'org (scopés marque active), filtrables par ?status=. */
export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const activeBrandId = await getActiveBrandId(ctx.organizationId);
  const statusParam = new URL(req.url).searchParams.get('status');
  const status = STATUSES.includes(statusParam as never) ? (statusParam as typeof STATUSES[number]) : undefined;

  const items = await db.prospect.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(activeBrandId ? { OR: [{ brandId: activeBrandId }, { brandId: null }] } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return ok({ items });
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  organizationName: z.string().max(200).optional(),
  role: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().max(60).optional(),
  website: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  notes: z.string().max(5000).optional(),
});

/** POST /api/prospects — ajout MANUEL d'une cible (rattachée à la marque active). */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = createSchema.parse(await req.json());
  const activeBrandId = await getActiveBrandId(ctx.organizationId);

  // Doublon évident signalé plutôt que dupliqué silencieusement.
  if (body.email) {
    const dup = await db.prospect.findFirst({
      where: { organizationId: ctx.organizationId, email: body.email.toLowerCase() },
      select: { id: true, name: true },
    });
    if (dup) {
      return ok({ error: `Un prospect avec cet email existe déjà (« ${dup.name} »).` }, { status: 409 });
    }
  }

  const prospect = await db.prospect.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: activeBrandId,
      name: body.name.trim(),
      organizationName: body.organizationName?.trim() || null,
      role: body.role?.trim() || null,
      email: body.email?.toLowerCase() ?? null,
      phone: body.phone?.trim() || null,
      website: body.website?.trim() || null,
      city: body.city?.trim() || null,
      notes: body.notes?.trim() || null,
      source: 'Ajout manuel',
      status: 'NEW',
      rawData: { provider: 'manual' } as never,
    },
  });
  return created(prospect);
});
