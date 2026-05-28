import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { getIntegration } from '@/lib/integration-configs';

/**
 * Quick health probe for any integration.
 * Strategy:
 *   1. Look up the integration in INTEGRATIONS config
 *   2. Check all required env vars are present in the current runtime
 *   3. If a real probe is defined for this provider, run it
 *   4. Always return a structured response with envPresent map
 *
 * Note: env vars set via Vercel API are only available after a redeploy.
 * If "Tester la connexion" fails right after save, redeploy and retry.
 */

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export const POST = handle(async (_req, { params }) => {
  await requireSuperAdmin();
  const { provider } = await params;

  const cfg = getIntegration(provider);
  if (!cfg) return ok({ ok: false, reason: `Provider inconnu: ${provider}`, envPresent: {} });

  // Build envPresent map
  const envPresent: Record<string, boolean> = {};
  for (const v of cfg.envVars) {
    const value = process.env[v.key];
    if (v.type === 'boolean') {
      envPresent[v.key] = value === 'true';
    } else {
      envPresent[v.key] = !!value && value.length > 0;
    }
  }

  // Check required vars are present
  const missingRequired = cfg.envVars
    .filter((v) => v.required && !envPresent[v.key])
    .map((v) => v.key);
  if (missingRequired.length > 0) {
    return ok({
      ok: false,
      reason: `Env vars requis manquants : ${missingRequired.join(', ')}. Pose-les ci-dessus puis Enregistrer + redéployer.`,
      envPresent,
    });
  }

  // Provider-specific probe
  const t = Date.now();
  try {
    const result = await runProbe(provider);
    return ok({ ...result, latencyMs: Date.now() - t, envPresent });
  } catch (err) {
    return ok({ ok: false, reason: (err as Error).message, latencyMs: Date.now() - t, envPresent });
  }
});

async function runProbe(provider: string): Promise<{ ok: boolean; reason?: string; status?: number }> {
  switch (provider) {
    case 'anthropic': {
      const r = await withTimeout(fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      }), 5000);
      if (!r.ok) return { ok: false, status: r.status, reason: `Anthropic ${r.status}: clé invalide ou révoquée` };
      return { ok: true, status: r.status };
    }
    case 'openai': {
      const r = await withTimeout(fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!}` },
      }), 5000);
      if (!r.ok) return { ok: false, status: r.status, reason: `OpenAI ${r.status}` };
      return { ok: true, status: r.status };
    }
    case 'gemini': {
      const key = process.env.GOOGLE_GEMINI_API_KEY!;
      const r = await withTimeout(fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`), 5000);
      if (!r.ok) return { ok: false, status: r.status, reason: `Gemini ${r.status}` };
      return { ok: true, status: r.status };
    }
    case 'stability': {
      const r = await withTimeout(fetch('https://api.stability.ai/v1/user/account', {
        headers: { Authorization: `Bearer ${process.env.STABILITY_API_KEY!}` },
      }), 5000);
      if (!r.ok) return { ok: false, status: r.status, reason: `Stability ${r.status}` };
      return { ok: true, status: r.status };
    }
    case 'replicate': {
      const r = await withTimeout(fetch('https://api.replicate.com/v1/account', {
        headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN!}` },
      }), 5000);
      if (!r.ok) return { ok: false, status: r.status, reason: `Replicate ${r.status}` };
      return { ok: true, status: r.status };
    }
    case 'canva': {
      const enabled = process.env.ENABLE_CANVA_API === 'true';
      return enabled
        ? { ok: true, reason: 'Env vars OK. Lance OAuth via /admin/connections.' }
        : { ok: false, reason: 'ENABLE_CANVA_API doit être true' };
    }
    case 'supabase': {
      const rawUrl = process.env.SUPABASE_URL!;
      const url = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'socialflow-media';

      // Verify the key is a service_role JWT, not anon
      let keyRole: string | undefined;
      try {
        const payloadB64 = key.split('.')[1];
        if (payloadB64) {
          const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8'));
          keyRole = payload.role;
        }
      } catch { /* ignore */ }
      if (keyRole && keyRole !== 'service_role') {
        return {
          ok: false,
          status: 400,
          reason: `Tu as posé la clé "${keyRole}" — il faut la "service_role" key. Va sur supabase.com/dashboard/project/_/settings/api → onglet "API Keys" → révèle "service_role" → copie-la dans le wizard.`,
        };
      }

      const r = await withTimeout(fetch(`${url}/storage/v1/bucket/${bucket}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      }), 5000);
      if (r.status === 404) {
        return { ok: false, status: 404, reason: `Bucket "${bucket}" inexistant — crée-le sur supabase.com/dashboard/project/_/storage/buckets en Public` };
      }
      if (r.status === 400 || r.status === 401) {
        const txt = await r.text().catch(() => '');
        return {
          ok: false,
          status: r.status,
          reason: `Supabase ${r.status}: clé refusée. Vérifie que SUPABASE_SERVICE_ROLE_KEY est bien la service_role (pas l'anon). Détail: ${txt.slice(0, 150)}`,
        };
      }
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return { ok: false, status: r.status, reason: `Supabase ${r.status}: ${txt.slice(0, 200)}` };
      }
      return { ok: true, status: r.status };
    }
    case 'redis': {
      const url = process.env.REDIS_URL!;
      if (!/^rediss?:\/\//.test(url)) return { ok: false, reason: 'URL invalide — doit commencer par redis:// ou rediss://' };
      return { ok: true, reason: 'Format OK (probe runtime non implémenté pour serverless)' };
    }
    case 'stripe': {
      const r = await withTimeout(fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY!}` },
      }), 5000);
      if (!r.ok) return { ok: false, status: r.status, reason: `Stripe ${r.status}: clé invalide` };
      return { ok: true, status: r.status };
    }
    case 'github': {
      const repo = process.env.GITHUB_REPO ?? 'mounemus/socialflow-ai-studio';
      const r = await withTimeout(fetch(`https://api.github.com/repos/${repo}`, {
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN!}`, Accept: 'application/vnd.github+json' },
      }), 5000);
      if (!r.ok) return { ok: false, status: r.status, reason: `GitHub ${r.status}` };
      return { ok: true, status: r.status };
    }
    case 'vercel': {
      const r = await withTimeout(fetch(`https://api.vercel.com/v9/projects/${process.env.VERCEL_PROJECT_ID}`, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN!}` },
      }), 5000);
      if (!r.ok) return { ok: false, status: r.status, reason: `Vercel ${r.status}` };
      return { ok: true, status: r.status };
    }
    case 'facebook':
    case 'linkedin':
    case 'twitter':
    case 'tiktok':
    case 'youtube':
    case 'pinterest':
      return { ok: true, reason: 'Env vars OK. Vraie validation lors du flow OAuth utilisateur (à venir).' };
    default:
      return { ok: true, reason: 'Env vars OK. Probe live non implémenté pour cette intégration.' };
  }
}
