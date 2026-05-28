import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { ExternalApiError } from '@/lib/errors';

/**
 * Quick poll endpoint: returns the latest production deployment status.
 * Used by wizards to show progress during a redeploy.
 */
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireSuperAdmin();

  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    return ok({ configured: false });
  }

  const team = process.env.VERCEL_TEAM_ID ? `&teamId=${process.env.VERCEL_TEAM_ID}` : '';
  const res = await fetch(`https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1&target=production${team}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ExternalApiError('vercel', `${res.status}`);
  const data = (await res.json()) as {
    deployments?: { uid: string; url: string; state: string; readyState: string; created: number }[];
  };
  const last = data.deployments?.[0];
  if (!last) return ok({ configured: true, deployment: null });

  return ok({
    configured: true,
    deployment: {
      id: last.uid,
      url: last.url,
      state: last.readyState ?? last.state,
      createdAt: new Date(last.created).toISOString(),
      ageSeconds: Math.round((Date.now() - last.created) / 1000),
    },
  });
});
