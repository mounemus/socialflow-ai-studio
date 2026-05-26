import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';

/**
 * Quick health probe for a single integration. Used by wizards to validate config
 * before completing the flow.
 */
export const POST = handle(async (_req, { params }) => {
  await requireSuperAdmin();
  const { provider } = await params;

  const t = Date.now();
  try {
    switch (provider) {
      case 'anthropic': {
        if (!process.env.ANTHROPIC_API_KEY) return ok({ ok: false, reason: 'ANTHROPIC_API_KEY not set in current deployment (redeploy required)' });
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        });
        return ok({ ok: r.ok, status: r.status, latencyMs: Date.now() - t });
      }
      case 'openai': {
        if (!process.env.OPENAI_API_KEY) return ok({ ok: false, reason: 'OPENAI_API_KEY not set in current deployment' });
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        });
        return ok({ ok: r.ok, status: r.status, latencyMs: Date.now() - t });
      }
      case 'canva': {
        const ready = !!process.env.CANVA_CLIENT_ID && !!process.env.CANVA_CLIENT_SECRET && process.env.ENABLE_CANVA_API === 'true';
        return ok({
          ok: ready,
          reason: ready ? undefined : 'Env vars manquantes — set CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, ENABLE_CANVA_API=true then redeploy',
          envPresent: {
            CANVA_CLIENT_ID: !!process.env.CANVA_CLIENT_ID,
            CANVA_CLIENT_SECRET: !!process.env.CANVA_CLIENT_SECRET,
            CANVA_REDIRECT_URI: !!process.env.CANVA_REDIRECT_URI,
            ENABLE_CANVA_API: process.env.ENABLE_CANVA_API === 'true',
          },
        });
      }
      case 'github': {
        if (!process.env.GITHUB_TOKEN) return ok({ ok: false, reason: 'GITHUB_TOKEN not set' });
        const repo = process.env.GITHUB_REPO ?? 'mounemus/socialflow-ai-studio';
        const r = await fetch(`https://api.github.com/repos/${repo}`, {
          headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
        });
        return ok({ ok: r.ok, status: r.status, latencyMs: Date.now() - t });
      }
      case 'vercel': {
        if (!process.env.VERCEL_API_TOKEN) return ok({ ok: false, reason: 'VERCEL_API_TOKEN not set' });
        const r = await fetch(`https://api.vercel.com/v9/projects/${process.env.VERCEL_PROJECT_ID}`, {
          headers: { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}` },
        });
        return ok({ ok: r.ok, status: r.status, latencyMs: Date.now() - t });
      }
      default:
        return ok({ ok: false, reason: 'Unknown provider' });
    }
  } catch (err) {
    return ok({ ok: false, reason: (err as Error).message });
  }
});
