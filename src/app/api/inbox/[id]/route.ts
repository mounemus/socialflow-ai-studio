import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolveInteractionContext } from '@/lib/tenant';
import { db } from '@/lib/db';

const patchSchema = z.object({
  status: z.string().optional(),
  sentiment: z.string().optional(),
  assignedToId: z.string().nullable().optional(),
});

export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  const { organizationId } = await resolveInteractionContext(id);

  const interaction = await db.socialInteraction.findUnique({
    where: { id },
    include: {
      brand: true,
      socialAccount: true,
      post: true,
      assignedTo: { select: { id: true, name: true, email: true, image: true } },
      repliedBy: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  const threadInteractions = interaction?.threadId
    ? await db.socialInteraction.findMany({
        where: {
          organizationId,
          threadId: interaction.threadId,
          id: { not: id },
        },
        orderBy: { receivedAt: 'asc' },
        include: {
          assignedTo: { select: { id: true, name: true, email: true, image: true } },
          repliedBy: { select: { id: true, name: true, email: true, image: true } },
        },
      })
    : [];

  return ok({
    interaction,
    threadInteractions,
    post: interaction?.post ?? null,
    brand: interaction?.brand ?? null,
  });
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const { organizationId } = await resolveInteractionContext(id);
  const body = patchSchema.parse(await req.json());

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status as never;
  if (body.sentiment !== undefined) data.sentiment = body.sentiment as never;
  if (body.assignedToId !== undefined) data.assignedToId = body.assignedToId;

  const updated = await db.socialInteraction.update({
    where: { id },
    data: data as never,
  });

  // Lire une conversation = lire TOUT son fil : les DMs sont ingérés message
  // par message (même threadId) — sans ça, les frères restaient NEW et le
  // badge « non lus » ne descendait jamais malgré la lecture.
  if (body.status === 'READ' && updated.threadId) {
    await db.socialInteraction.updateMany({
      where: { organizationId, threadId: updated.threadId, status: 'NEW' as never },
      data: { status: 'READ' as never },
    });
  }

  return ok(updated);
});
