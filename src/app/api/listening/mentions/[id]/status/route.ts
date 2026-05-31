import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

const bodySchema = z.object({
  status: z.enum(['NEW', 'PROCESSED', 'IGNORED']),
});

export const POST = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const { status } = bodySchema.parse(await req.json());

  const mention = await db.brandMention.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, rawData: true },
  });
  if (!mention) throw new NotFoundError('Mention not found');

  const raw = (mention.rawData && typeof mention.rawData === 'object' ? mention.rawData : {}) as Record<
    string,
    unknown
  >;
  await db.brandMention.update({
    where: { id: mention.id },
    data: { rawData: { ...raw, status } as Prisma.InputJsonValue },
  });

  return ok({ id: mention.id, status });
});
