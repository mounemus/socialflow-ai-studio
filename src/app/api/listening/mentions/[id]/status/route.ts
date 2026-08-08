import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

const bodySchema = z.object({
  status: z.enum(['NEW', 'PROCESSED', 'IGNORED']),
});

// Statut client → colonne MentionStatus. Historiquement ce endpoint écrivait le
// statut dans rawData (jamais relu depuis que la liste lit la vraie colonne) ;
// on écrit désormais la colonne, seule source de vérité.
const COLUMN_STATUS = {
  NEW: 'NEW',
  PROCESSED: 'REVIEWED',
  IGNORED: 'IGNORED',
} as const;

export const POST = handle(async (req, { params }) => {
  const ctx = await requireTenant();
  const { id } = await params;
  const { status } = bodySchema.parse(await req.json());

  const mention = await db.brandMention.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!mention) throw new NotFoundError('Mention not found');

  await db.brandMention.update({
    where: { id: mention.id },
    data: { status: COLUMN_STATUS[status] as never },
  });

  return ok({ id: mention.id, status });
});
