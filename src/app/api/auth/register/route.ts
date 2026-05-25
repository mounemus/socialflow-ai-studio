import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { handle, created } from '@/lib/api';
import { ValidationError } from '@/lib/errors';
import { slugify } from '@/lib/utils';

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  orgName: z.string().min(1),
});

export const POST = handle(async (req) => {
  const body = schema.parse(await req.json());

  const existing = await db.user.findUnique({ where: { email: body.email } });
  if (existing) throw new ValidationError('Email déjà utilisé');

  const hash = await bcrypt.hash(body.password, 10);

  const baseSlug = slugify(body.orgName) || 'org';
  let slug = baseSlug;
  let suffix = 1;
  while (await db.organization.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix++}`;
  }

  const user = await db.user.create({
    data: {
      email: body.email,
      name: body.name,
      passwordHash: hash,
      memberships: {
        create: {
          role: 'OWNER',
          organization: {
            create: { name: body.orgName, slug, plan: 'FREE' },
          },
        },
      },
    },
  });

  return created({ userId: user.id });
});
