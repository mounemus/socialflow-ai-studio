import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { db } from '@/lib/db';

const addSchema = z.object({
  userId: z.string(),
  role: z.enum(['OWNER', 'ADMIN', 'STRATEGIST', 'DESIGNER', 'EDITOR', 'CLIENT', 'VIEWER']).default('EDITOR'),
});

export const POST = handle(async (req, { params }) => {
  const admin = await requireSuperAdmin();
  const { id: organizationId } = await params;
  const body = addSchema.parse(await req.json());
  const member = await db.teamMember.upsert({
    where: { userId_organizationId: { userId: body.userId, organizationId } },
    update: { role: body.role },
    create: { userId: body.userId, organizationId, role: body.role },
  });
  await db.auditLog.create({
    data: { userId: admin.id, action: 'admin.org.member.add', resource: 'team_member', resourceId: member.id, metadata: { organizationId, addedUserId: body.userId, role: body.role } as never },
  });
  return created(member);
});
