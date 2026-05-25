import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { handle, ok, created } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { slugify } from '@/lib/utils';

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8).optional(),
  globalRole: z.enum(['SUPER_ADMIN', 'OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER']).default('OWNER'),
  createOrganization: z.boolean().default(false),
  organizationName: z.string().optional(),
  attachToOrganizationId: z.string().optional(),
  attachWithRole: z.enum(['OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER']).default('EDITOR'),
});

export const GET = handle(async (req) => {
  await requireSuperAdmin();
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const where = q
    ? { OR: [{ email: { contains: q, mode: 'insensitive' as const } }, { name: { contains: q, mode: 'insensitive' as const } }] }
    : {};
  const users = await db.user.findMany({
    where,
    include: {
      memberships: { include: { organization: true } },
      _count: { select: { createdPosts: true, aiRequests: true, agentRuns: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return ok(users);
});

export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin();
  const body = createSchema.parse(await req.json());

  const existing = await db.user.findUnique({ where: { email: body.email } });
  if (existing) throw new ValidationError('Email déjà utilisé');

  const rawPassword = body.password ?? crypto.randomBytes(12).toString('base64url').slice(0, 12);
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: body.email, name: body.name, passwordHash, globalRole: body.globalRole },
    });

    if (body.createOrganization && body.organizationName) {
      const baseSlug = slugify(body.organizationName) || 'org';
      let slug = baseSlug;
      let suffix = 1;
      while (await tx.organization.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${suffix++}`;
      }
      const org = await tx.organization.create({
        data: { name: body.organizationName, slug, plan: 'FREE' },
      });
      await tx.teamMember.create({
        data: { userId: user.id, organizationId: org.id, role: 'OWNER' },
      });
      return { user, organization: org };
    }

    if (body.attachToOrganizationId) {
      await tx.teamMember.create({
        data: { userId: user.id, organizationId: body.attachToOrganizationId, role: body.attachWithRole },
      });
    }

    return { user, organization: null };
  });

  await db.auditLog.create({
    data: {
      userId: admin.id,
      action: 'admin.user.create',
      resource: 'user',
      resourceId: result.user.id,
      metadata: { email: body.email } as never,
    },
  });

  return created({
    user: result.user,
    organization: result.organization,
    // Returned ONCE, never stored. The admin must communicate it to the user.
    initialPassword: body.password ? undefined : rawPassword,
  });
});
