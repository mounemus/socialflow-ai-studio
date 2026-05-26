/**
 * VercelApiService — manage env vars on the Vercel project via REST API.
 * Requires VERCEL_API_TOKEN (Account → Tokens) and VERCEL_PROJECT_ID.
 * VERCEL_TEAM_ID optional (auto-detected via Account API if absent).
 *
 * Docs: https://vercel.com/docs/rest-api/endpoints/projects#create-one-or-more-environment-variables
 *
 * SECURITY: this service is ONLY callable by SUPER_ADMIN (enforced in API routes).
 * Never expose the token to the client.
 */
import { ExternalApiError } from '@/lib/errors';

const VERCEL_API = 'https://api.vercel.com';

export type VercelEnvTarget = 'production' | 'preview' | 'development';
export type VercelEnvType = 'plain' | 'encrypted' | 'sensitive' | 'system';

export interface VercelEnvVar {
  id: string;
  key: string;
  value?: string;
  type: VercelEnvType;
  target: VercelEnvTarget[];
  createdAt?: number;
  updatedAt?: number;
}

function getConfig() {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token) throw new ExternalApiError('vercel', 'VERCEL_API_TOKEN missing');
  if (!projectId) throw new ExternalApiError('vercel', 'VERCEL_PROJECT_ID missing');
  return { token, projectId, teamId };
}

function withTeam(path: string, teamId?: string): string {
  if (!teamId) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}teamId=${teamId}`;
}

async function vercelFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token, teamId } = getConfig();
  const url = `${VERCEL_API}${withTeam(path, teamId)}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new ExternalApiError('vercel', `${res.status} ${txt}`);
  }
  return (await res.json()) as T;
}

export const VercelApiService = {
  isConfigured(): boolean {
    return !!(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID);
  },

  async listEnvVars(decrypt = false): Promise<VercelEnvVar[]> {
    const { projectId } = getConfig();
    const path = `/v9/projects/${projectId}/env${decrypt ? '?decrypt=true' : ''}`;
    const data = await vercelFetch<{ envs: VercelEnvVar[] }>(path);
    return data.envs;
  },

  async createEnvVar(input: {
    key: string;
    value: string;
    target: VercelEnvTarget[];
    type?: VercelEnvType;
    comment?: string;
  }): Promise<VercelEnvVar> {
    const { projectId } = getConfig();
    return vercelFetch<VercelEnvVar>(`/v10/projects/${projectId}/env?upsert=true`, {
      method: 'POST',
      body: JSON.stringify({
        key: input.key,
        value: input.value,
        target: input.target,
        type: input.type ?? 'encrypted',
        comment: input.comment,
      }),
    });
  },

  async updateEnvVar(envId: string, input: { value?: string; target?: VercelEnvTarget[]; type?: VercelEnvType }): Promise<VercelEnvVar> {
    const { projectId } = getConfig();
    return vercelFetch<VercelEnvVar>(`/v9/projects/${projectId}/env/${envId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async deleteEnvVar(envId: string): Promise<void> {
    const { projectId } = getConfig();
    await vercelFetch(`/v9/projects/${projectId}/env/${envId}`, { method: 'DELETE' });
  },

  /**
   * Trigger a fresh production deployment from the linked git repository.
   * Strategy:
   *   1. Fetch the project to get `link.repoId` (required by deployments API)
   *   2. Fetch the most recent production deployment to learn ref + sha
   *   3. POST /v13/deployments with complete gitSource
   *
   * Falls back to triggering via the deployment-hook endpoint if available.
   */
  async redeployFromGit(): Promise<{ id: string; url: string }> {
    const { projectId } = getConfig();

    // Step 1: project link info
    const project = await vercelFetch<{
      name?: string;
      link?: { type?: string; repoId?: number | string; repo?: string; org?: string; productionBranch?: string };
    }>(`/v9/projects/${projectId}`);

    const repoId = project.link?.repoId;
    const linkType = project.link?.type ?? 'github';
    if (!repoId) {
      throw new ExternalApiError(
        'vercel',
        'Project is not linked to a Git repository (or VERCEL_API_TOKEN scope insufficient). Trigger a deploy by pushing a commit instead.',
      );
    }

    // Step 2: last production deployment for ref + sha
    const recent = await vercelFetch<{ deployments: { uid: string; meta?: { githubCommitSha?: string; githubCommitRef?: string; gitlabCommitSha?: string; gitlabCommitRef?: string; bitbucketCommitSha?: string; bitbucketCommitRef?: string }; name?: string }[] }>(
      `/v6/deployments?projectId=${projectId}&limit=1&target=production`,
    );
    const last = recent.deployments?.[0];
    const meta = last?.meta ?? {};
    const sha = meta.githubCommitSha ?? meta.gitlabCommitSha ?? meta.bitbucketCommitSha;
    const ref = meta.githubCommitRef ?? meta.gitlabCommitRef ?? meta.bitbucketCommitRef ?? project.link?.productionBranch ?? 'main';
    if (!sha) {
      throw new ExternalApiError('vercel', 'No previous git deployment found - push a commit to trigger first deploy');
    }

    // Step 3: trigger fresh deploy
    const data = await vercelFetch<{ id: string; url: string }>(`/v13/deployments?forceNew=1`, {
      method: 'POST',
      body: JSON.stringify({
        name: project.name ?? last?.name ?? 'socialflow-ai-studio',
        target: 'production',
        gitSource: {
          type: linkType,
          repoId,
          ref,
          sha,
        },
      }),
    });
    return { id: data.id, url: data.url };
  },
};

// Known integration "slots" — the UI shows them as a curated list with status.
export const KNOWN_INTEGRATIONS: { key: string; label: string; group: string; doc?: string }[] = [
  { key: 'OPENAI_API_KEY', label: 'OpenAI', group: 'AI', doc: 'https://platform.openai.com/api-keys' },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic Claude', group: 'AI', doc: 'https://console.anthropic.com/' },
  { key: 'GOOGLE_GEMINI_API_KEY', label: 'Google Gemini', group: 'AI', doc: 'https://aistudio.google.com/apikey' },
  { key: 'REPLICATE_API_TOKEN', label: 'Replicate', group: 'AI' },
  { key: 'STABILITY_API_KEY', label: 'Stability AI', group: 'AI' },
  { key: 'ENABLE_REAL_AI', label: 'Activer IA réelle', group: 'AI flags' },
  { key: 'AI_DEFAULT_TEXT_PROVIDER', label: 'Provider texte par défaut', group: 'AI flags' },

  { key: 'CANVA_CLIENT_ID', label: 'Canva Client ID', group: 'Canva' },
  { key: 'CANVA_CLIENT_SECRET', label: 'Canva Secret', group: 'Canva' },
  { key: 'ENABLE_CANVA_API', label: 'Activer Canva API', group: 'Canva' },

  { key: 'FACEBOOK_APP_ID', label: 'Facebook App ID', group: 'Social' },
  { key: 'FACEBOOK_APP_SECRET', label: 'Facebook Secret', group: 'Social' },
  { key: 'INSTAGRAM_APP_ID', label: 'Instagram App ID', group: 'Social' },
  { key: 'INSTAGRAM_APP_SECRET', label: 'Instagram Secret', group: 'Social' },
  { key: 'LINKEDIN_CLIENT_ID', label: 'LinkedIn Client ID', group: 'Social' },
  { key: 'LINKEDIN_CLIENT_SECRET', label: 'LinkedIn Secret', group: 'Social' },
  { key: 'TWITTER_CLIENT_ID', label: 'X Client ID', group: 'Social' },
  { key: 'TWITTER_CLIENT_SECRET', label: 'X Secret', group: 'Social' },
  { key: 'TIKTOK_CLIENT_KEY', label: 'TikTok Client', group: 'Social' },
  { key: 'TIKTOK_CLIENT_SECRET', label: 'TikTok Secret', group: 'Social' },
  { key: 'YOUTUBE_CLIENT_ID', label: 'YouTube Client ID', group: 'Social' },
  { key: 'YOUTUBE_CLIENT_SECRET', label: 'YouTube Secret', group: 'Social' },
  { key: 'PINTEREST_APP_ID', label: 'Pinterest App ID', group: 'Social' },
  { key: 'PINTEREST_APP_SECRET', label: 'Pinterest Secret', group: 'Social' },
  { key: 'ENABLE_REAL_PUBLISHING', label: 'Activer publication réelle', group: 'Social flags' },

  { key: 'REDIS_URL', label: 'Redis (queues)', group: 'Infra' },
  { key: 'STRIPE_SECRET_KEY', label: 'Stripe secret', group: 'Billing' },
  { key: 'STRIPE_WEBHOOK_SECRET', label: 'Stripe webhook secret', group: 'Billing' },

  { key: 'SUPABASE_URL', label: 'Supabase URL', group: 'Storage' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase service role', group: 'Storage' },
  { key: 'SUPABASE_STORAGE_BUCKET', label: 'Supabase bucket', group: 'Storage' },
];
