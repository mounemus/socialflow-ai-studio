import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireTenant, getActiveBrandId } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { OutreachService } from '@/services/outreach/OutreachService';
import { GoogleMailService } from '@/services/integrations/GoogleMailService';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createSchema = z.object({
  channel: z.enum(['EMAIL', 'SOCIAL_DM']),
  name: z.string().min(1).max(200),
  subject: z.string().max(300).optional(),
  // 60k : un email HTML complet (kit de campagne) fait couramment 15-40k.
  body: z.string().min(1).max(60000),
  brandId: z.string().optional(),
  campaignId: z.string().optional(),
  platform: z.string().optional(),
  // EMAIL : liste d'adresses. SOCIAL_DM : contacts {handle, name, interactionId}.
  emails: z.array(z.string()).max(500).optional(),
  contacts: z
    .array(z.object({
      handle: z.string(),
      name: z.string().optional(),
      interactionId: z.string().optional(),
    }))
    .max(500)
    .optional(),
  // EMAIL uniquement : pièces jointes déjà uploadées (Bibliothèque média).
  attachments: z
    .array(z.object({
      name: z.string(),
      url: z.string(),
      mimeType: z.string().optional(),
      sizeBytes: z.number().optional(),
    }))
    .max(5)
    .optional(),
});

/**
 * GET  /api/outreach — campagnes d'outreach de l'org (scopées marque active)
 * POST /api/outreach — créer une campagne + ses destinataires (statut DRAFT)
 */
export const GET = handle(async () => {
  const ctx = await requireTenant();
  const activeBrandId = await getActiveBrandId(ctx.organizationId);
  const items = await db.outreachCampaign.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(activeBrandId ? { OR: [{ brandId: activeBrandId }, { brandId: null }] } : {}),
    },
    include: {
      recipients: { select: { status: true } },
      brand: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const gmail = await GoogleMailService.status(ctx.organizationId);
  return ok({ items, emailConfigured: OutreachService.emailConfigured(), gmail });
});

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'campaign.manage');
  const body = createSchema.parse(await req.json());

  if (body.channel === 'EMAIL') {
    const valid = (body.emails ?? []).map((e) => e.trim()).filter((e) => EMAIL_RE.test(e));
    if (valid.length === 0) {
      return ok({ error: 'Aucune adresse email valide.' }, { status: 422 });
    }
    const outreach = await db.outreachCampaign.create({
      data: {
        organizationId: ctx.organizationId,
        brandId: body.brandId,
        campaignId: body.campaignId,
        channel: 'EMAIL',
        name: body.name,
        subject: body.subject ?? body.name,
        body: body.body,
        attachments: body.attachments ?? [],
        createdById: ctx.userId,
        recipients: { create: [...new Set(valid)].map((email) => ({ email })) },
      },
      include: { recipients: true },
    });
    return created(outreach);
  }

  const contacts = body.contacts ?? [];
  if (contacts.length === 0) {
    return ok({ error: 'Aucun contact sélectionné.' }, { status: 422 });
  }
  const outreach = await db.outreachCampaign.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: body.brandId,
      campaignId: body.campaignId,
      channel: 'SOCIAL_DM',
      platform: (body.platform as never) ?? null,
      name: body.name,
      body: body.body,
      createdById: ctx.userId,
      recipients: {
        create: contacts.map((c) => ({
          handle: c.handle,
          name: c.name,
          interactionId: c.interactionId,
        })),
      },
    },
    include: { recipients: true },
  });
  return created(outreach);
});
