import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().max(300).optional(),
  body: z.string().min(1).max(60000).optional(),
  attachments: z
    .array(z.object({
      name: z.string(),
      url: z.string(),
      mimeType: z.string().optional(),
      sizeBytes: z.number().optional(),
    }))
    .max(5)
    .optional(),
  // EMAIL uniquement : remplace la liste des destinataires (brouillon seulement).
  emails: z.array(z.string()).max(500).optional(),
});

/**
 * GET    /api/outreach/[id] — campagne + destinataires (pour l'éditer)
 * PATCH  /api/outreach/[id] — modifier un brouillon (contenu + destinataires)
 * DELETE /api/outreach/[id] — supprimer une campagne
 */
export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  const item = await db.outreachCampaign.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { recipients: true },
  });
  if (!item) return ok({ error: 'Campagne introuvable.' }, { status: 404 });
  return ok(item);
});

export const PATCH = handle(async (req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = patchSchema.parse(await req.json());

  const existing = await db.outreachCampaign.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!existing) return ok({ error: 'Campagne introuvable.' }, { status: 404 });
  if (existing.status !== 'DRAFT' && existing.status !== 'FAILED' && existing.status !== 'PARTIAL') {
    return ok({ error: 'Seuls les brouillons (ou campagnes en échec) sont modifiables.' }, { status: 409 });
  }

  if (body.emails) {
    if (existing.channel !== 'EMAIL') {
      return ok({ error: 'Destinataires email uniquement sur le canal EMAIL.' }, { status: 422 });
    }
    const valid = [...new Set(body.emails.map((e) => e.trim()).filter((e) => EMAIL_RE.test(e)))];
    if (valid.length === 0) {
      return ok({ error: 'Aucune adresse email valide.' }, { status: 422 });
    }
    // Remplace uniquement les destinataires pas encore traités — ceux déjà
    // envoyés gardent leur historique.
    await db.outreachRecipient.deleteMany({ where: { outreachId: id, status: 'PENDING' } });
    const already = await db.outreachRecipient.findMany({
      where: { outreachId: id }, select: { email: true },
    });
    const seen = new Set(already.map((r) => r.email).filter(Boolean));
    await db.outreachRecipient.createMany({
      data: valid.filter((e) => !seen.has(e)).map((email) => ({ outreachId: id, email })),
    });
  }

  const updated = await db.outreachCampaign.update({
    where: { id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.subject !== undefined ? { subject: body.subject } : {}),
      ...(body.body ? { body: body.body } : {}),
      ...(body.attachments ? { attachments: body.attachments } : {}),
    },
    include: { recipients: true },
  });
  return ok(updated);
});

export const DELETE = handle(async (_req, { params }) => {
  const { id } = await params;
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const existing = await db.outreachCampaign.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!existing) return ok({ error: 'Campagne introuvable.' }, { status: 404 });
  await db.outreachCampaign.delete({ where: { id } });
  return ok({ deleted: true });
});
