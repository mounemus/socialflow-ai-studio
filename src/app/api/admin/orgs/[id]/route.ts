import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

const patchSchema = z.object({
  name: z.string().optional(),
  plan: z.enum(['FREE', 'PRO', 'AGENCY', 'ENTERPRISE']).optional(),
});

export const GET = handle(async (_req, { params }) => {
  await requireSuperAdmin();
  const { id } = await params;
  const org = await db.organization.findUnique({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, email: true, name: true, disabled: true } } } },
      brands: { include: { _count: { select: { posts: true, socialAccounts: true } } } },
      socialAccounts: true,
      subscription: true,
      _count: { select: { posts: true, campaigns: true, automations: true, trendWatches: true, competitors: true, agentRuns: true } },
    },
  });
  if (!org) throw new NotFoundError('Organization not found');
  return ok(org);
});

export const PATCH = handle(async (req, { params }) => {
  const admin = await requireSuperAdmin();
  const { id } = await params;
  const body = patchSchema.parse(await req.json());
  const org = await db.organization.update({ where: { id }, data: body });
  await db.auditLog.create({
    data: { userId: admin.id, action: 'admin.org.update', resource: 'organization', resourceId: id, metadata: body as never },
  });
  return ok(org);
});

export const DELETE = handle(async (_req, { params }) => {
  const admin = await requireSuperAdmin();
  const { id } = await params;
  await db.organization.delete({ where: { id } });
  await db.auditLog.create({
    data: { userId: admin.id, action: 'admin.org.delete', resource: 'organization', resourceId: id },
  });
  return ok({ deleted: true });
});
