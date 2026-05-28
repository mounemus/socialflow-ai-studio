import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { GeminiService } from '@/services/ai/GeminiService';

const schema = z.object({
  brandId: z.string().optional(),
});

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Daily intelligence brief — pulls together org-wide data and asks Gemini
 * (with its 1M+ context window) to produce a strategic summary.
 */
export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  const body = schema.parse(await req.json().catch(() => ({})));

  if (!GeminiService.isConfigured()) {
    return ok({ configured: false, message: 'GOOGLE_GEMINI_API_KEY manquant.' });
  }

  // Pick brand context: specified brand or first brand in org
  const brand = body.brandId
    ? await db.brand.findFirst({ where: { id: body.brandId, organizationId: ctx.organizationId }, include: { profile: true } })
    : await db.brand.findFirst({ where: { organizationId: ctx.organizationId }, include: { profile: true } });

  if (!brand) {
    return ok({ ok: false, error: 'Aucune marque trouvée dans cette org' });
  }

  // Gather data
  const [trendItems, competitorPosts, recentPosts] = await Promise.all([
    db.trendItem.findMany({
      where: { trendWatch: { organizationId: ctx.organizationId } },
      orderBy: [{ contentOpportunityScore: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    }),
    db.competitorPost.findMany({
      where: { competitor: { organizationId: ctx.organizationId } },
      orderBy: { postedAt: 'desc' },
      take: 30,
      include: { competitor: { select: { name: true } } },
    }),
    db.post.findMany({
      where: { organizationId: ctx.organizationId, brandId: brand.id, status: 'PUBLISHED' },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      include: { analytics: true },
    }),
  ]);

  const brief = await GeminiService.dailyIntelligenceBrief({
    brandContext: {
      name: brand.name,
      industry: brand.industry,
      toneOfVoice: brand.profile?.toneOfVoice,
    },
    trendItems: trendItems.map((t) => ({
      title: t.title,
      summary: t.summary,
      url: t.url,
      score: t.contentOpportunityScore ?? undefined,
    })),
    competitorPosts: competitorPosts.map((p) => ({
      competitor: p.competitor.name,
      caption: p.caption ?? undefined,
      postedAt: p.postedAt,
    })),
    recentPosts: recentPosts.map((p) => ({
      title: p.title,
      body: p.body,
      impressions: p.analytics.reduce((s, a) => s + a.impressions, 0),
      engagement: p.analytics.reduce((s, a) => s + a.likes + a.comments + a.shares, 0),
    })),
  });

  return ok({
    configured: true,
    brand: { id: brand.id, name: brand.name },
    dataPoints: {
      trendItems: trendItems.length,
      competitorPosts: competitorPosts.length,
      recentPosts: recentPosts.length,
    },
    brief,
    generatedAt: new Date().toISOString(),
  });
});
