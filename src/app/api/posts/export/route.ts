import { handle } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { postStatusMeta, platformFromFormat } from '@/lib/post-status';

export const dynamic = 'force-dynamic';

/** Échappement RFC-4180 : guillemets doublés, champ cité si nécessaire. */
function csvField(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/posts/export[?brandId=] — calendrier de contenu complet en CSV
 * (Excel/Sheets, BOM UTF-8). Une ligne par publication, avec créneau, statut,
 * identifiant externe et lien publié quand ils existent.
 */
export const GET = handle(async (req) => {
  const ctx = await requireTenant();
  const url = new URL(req.url);
  const brandId = url.searchParams.get('brandId') ?? undefined;

  const posts = await db.post.findMany({
    where: { organizationId: ctx.organizationId, ...(brandId ? { brandId } : {}) },
    select: {
      id: true, title: true, body: true, hashtags: true, status: true, format: true,
      createdAt: true, updatedAt: true,
      brand: { select: { name: true } },
      campaign: { select: { name: true } },
      schedules: {
        select: {
          scheduledFor: true, status: true, publishedAt: true, externalPostId: true,
          publishAttempts: {
            select: { externalUrl: true },
            where: { externalUrl: { not: null } },
            orderBy: { finishedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { scheduledFor: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 2000,
  });

  const header = [
    'id', 'titre', 'statut', 'plateforme', 'format', 'marque', 'campagne',
    'programme_pour', 'publie_le', 'id_externe', 'lien_publie', 'hashtags', 'texte',
  ];
  const rows = posts.map((p) => {
    const s = p.schedules[0] ?? null;
    return [
      p.id,
      p.title ?? '',
      postStatusMeta(p.status).label,
      platformFromFormat(p.format) ?? '',
      p.format,
      p.brand?.name ?? '',
      p.campaign?.name ?? '',
      s?.scheduledFor?.toISOString() ?? '',
      s?.publishedAt?.toISOString() ?? '',
      s?.externalPostId ?? '',
      s?.publishAttempts?.[0]?.externalUrl ?? '',
      p.hashtags.join(' '),
      (p.body ?? '').slice(0, 2000),
    ].map(csvField).join(',');
  });
  // BOM pour qu'Excel ouvre l'UTF-8 (accents) correctement.
  const csv = '﻿' + [header.join(','), ...rows].join('\r\n');

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="socialflow-publications-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
