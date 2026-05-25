/**
 * HealthService — checks each external dependency.
 * Each probe runs with a short timeout. Result includes status, latency, and a hint when failing.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export type ProbeStatus = 'ok' | 'degraded' | 'down' | 'not_configured';

export interface ProbeResult {
  key: string;
  label: string;
  status: ProbeStatus;
  latencyMs?: number;
  message?: string;
  hint?: string;
  required: boolean;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export const HealthService = {
  async probeDatabase(): Promise<ProbeResult> {
    const start = Date.now();
    try {
      await withTimeout(db.$queryRaw`SELECT 1`, 5000);
      return { key: 'db', label: 'Base de données (Supabase Postgres)', status: 'ok', latencyMs: Date.now() - start, required: true };
    } catch (err) {
      return { key: 'db', label: 'Base de données', status: 'down', message: (err as Error).message, hint: 'Vérifier DATABASE_URL', required: true };
    }
  },

  async probeAuth(): Promise<ProbeResult> {
    const hasSecret = !!process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16;
    const hasKey = !!process.env.TOKEN_ENCRYPTION_KEY && process.env.TOKEN_ENCRYPTION_KEY.length === 64;
    if (!hasSecret) return { key: 'auth', label: 'Auth', status: 'down', message: 'AUTH_SECRET manquant', required: true };
    if (!hasKey) return { key: 'auth', label: 'Auth', status: 'degraded', message: 'TOKEN_ENCRYPTION_KEY invalide (doit faire 64 chars hex)', required: true };
    return { key: 'auth', label: 'Auth (NextAuth + encryption)', status: 'ok', required: true };
  },

  async probeVercel(): Promise<ProbeResult> {
    if (!process.env.VERCEL_API_TOKEN || !process.env.VERCEL_PROJECT_ID) {
      return {
        key: 'vercel',
        label: 'Vercel API',
        status: 'not_configured',
        message: 'VERCEL_API_TOKEN et/ou VERCEL_PROJECT_ID manquant',
        hint: 'Créer un token sur vercel.com/account/tokens, l\'ajouter via Vercel dashboard',
        required: false,
      };
    }
    const start = Date.now();
    try {
      const path = `/v9/projects/${process.env.VERCEL_PROJECT_ID}/env${process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : ''}`;
      const res = await withTimeout(fetch(`https://api.vercel.com${path}`, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}` },
      }), 5000);
      if (!res.ok) return { key: 'vercel', label: 'Vercel API', status: 'down', message: `HTTP ${res.status}`, latencyMs: Date.now() - start, hint: 'Token invalide ou expiré', required: false };
      return { key: 'vercel', label: 'Vercel API', status: 'ok', latencyMs: Date.now() - start, required: false };
    } catch (err) {
      return { key: 'vercel', label: 'Vercel API', status: 'down', message: (err as Error).message, required: false };
    }
  },

  async probeAnthropic(): Promise<ProbeResult> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        key: 'anthropic',
        label: 'Anthropic Claude',
        status: 'not_configured',
        message: 'ANTHROPIC_API_KEY manquant',
        hint: 'console.anthropic.com → Settings → API Keys',
        required: false,
      };
    }
    const start = Date.now();
    try {
      // Light probe: GET /v1/models requires the key to be valid
      const res = await withTimeout(fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      }), 5000);
      if (!res.ok) return { key: 'anthropic', label: 'Anthropic Claude', status: 'down', message: `HTTP ${res.status}`, latencyMs: Date.now() - start, required: false };
      return { key: 'anthropic', label: 'Anthropic Claude', status: 'ok', latencyMs: Date.now() - start, required: false };
    } catch (err) {
      return { key: 'anthropic', label: 'Anthropic Claude', status: 'down', message: (err as Error).message, required: false };
    }
  },

  async probeOpenAI(): Promise<ProbeResult> {
    if (!process.env.OPENAI_API_KEY) {
      return { key: 'openai', label: 'OpenAI', status: 'not_configured', message: 'OPENAI_API_KEY manquant', hint: 'platform.openai.com/api-keys', required: false };
    }
    const start = Date.now();
    try {
      const res = await withTimeout(fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      }), 5000);
      if (!res.ok) return { key: 'openai', label: 'OpenAI', status: 'down', message: `HTTP ${res.status}`, latencyMs: Date.now() - start, required: false };
      return { key: 'openai', label: 'OpenAI', status: 'ok', latencyMs: Date.now() - start, required: false };
    } catch (err) {
      return { key: 'openai', label: 'OpenAI', status: 'down', message: (err as Error).message, required: false };
    }
  },

  async probeGitHub(): Promise<ProbeResult> {
    if (!process.env.GITHUB_TOKEN) {
      return { key: 'github', label: 'GitHub (Dev Agent)', status: 'not_configured', message: 'GITHUB_TOKEN manquant', required: false };
    }
    const start = Date.now();
    try {
      const repo = process.env.GITHUB_REPO ?? 'mounemus/socialflow-ai-studio';
      const res = await withTimeout(fetch(`https://api.github.com/repos/${repo}`, {
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
      }), 5000);
      if (!res.ok) return { key: 'github', label: 'GitHub', status: 'down', message: `HTTP ${res.status}`, latencyMs: Date.now() - start, hint: 'Token expiré ou pas de scope repo', required: false };
      return { key: 'github', label: 'GitHub', status: 'ok', latencyMs: Date.now() - start, required: false };
    } catch (err) {
      return { key: 'github', label: 'GitHub', status: 'down', message: (err as Error).message, required: false };
    }
  },

  async probeRedis(): Promise<ProbeResult> {
    if (!process.env.REDIS_URL || process.env.REDIS_URL === 'redis://localhost:6379') {
      return { key: 'redis', label: 'Redis (queues)', status: 'not_configured', message: 'REDIS_URL pas configuré — publication en synchrone', hint: 'Upstash Redis recommandé', required: false };
    }
    return { key: 'redis', label: 'Redis', status: 'ok', message: 'configuré (probe runtime non implémenté)', required: false };
  },

  async runAll(): Promise<ProbeResult[]> {
    const probes = await Promise.allSettled([
      this.probeDatabase(),
      this.probeAuth(),
      this.probeVercel(),
      this.probeAnthropic(),
      this.probeOpenAI(),
      this.probeGitHub(),
      this.probeRedis(),
    ]);
    return probes.map((p, i) => {
      if (p.status === 'fulfilled') return p.value;
      const keys = ['db', 'auth', 'vercel', 'anthropic', 'openai', 'github', 'redis'];
      logger.error('probe failed', { key: keys[i], err: p.reason });
      return { key: keys[i], label: keys[i], status: 'down' as ProbeStatus, message: 'probe crashed', required: i < 2 };
    });
  },
};
