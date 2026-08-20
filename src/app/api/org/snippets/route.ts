import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';

/**
 * Snippets réutilisables (signatures, CTA, mentions légales…) — stockés dans
 * Organization.settings.snippets, insérés depuis l'éditeur de texte social.
 * PUT remplace la liste entière (l'UI envoie l'état complet — pas de CRUD fin).
 */
const snippetSchema = z.object({
  label: z.string().min(1).max(60),
  text: z.string().min(1).max(2000),
});
const putSchema = z.object({ snippets: z.array(snippetSchema).max(50) });

function readSnippets(settings: unknown): Array<{ label: string; text: string }> {
  const raw = (settings as Record<string, unknown> | null)?.snippets;
  return Array.isArray(raw) ? (raw as Array<{ label: string; text: string }>) : [];
}

export const GET = handle(async () => {
  const ctx = await requireTenant();
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { settings: true },
  });
  return ok({ snippets: readSnippets(org?.settings) });
});

export const PUT = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'post.edit');
  const body = putSchema.parse(await req.json());
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { settings: true },
  });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  await db.organization.update({
    where: { id: ctx.organizationId },
    data: { settings: { ...settings, snippets: body.snippets } as never },
  });
  return ok({ snippets: body.snippets });
});
