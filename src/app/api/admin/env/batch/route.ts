import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { VercelApiService } from '@/services/vercel/VercelApiService';
import { apiBaseProblem } from '@/lib/env-guard';
import { db } from '@/lib/db';

const schema = z.object({
  vars: z.array(z.object({
    key: z.string().min(1),
    value: z.string(),
    type: z.enum(['plain', 'encrypted', 'sensitive']).default('encrypted'),
  })).min(1).max(20),
  redeploy: z.boolean().default(true),
});

/**
 * Atomically set N env vars + optionally trigger a redeploy.
 * Used by integration wizards to push CLIENT_ID + SECRET + REDIRECT_URI + ENABLE_FLAG in one shot.
 */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin();
  const body = schema.parse(await req.json());

  const results: { key: string; ok: boolean; error?: string }[] = [];
  for (const v of body.vars) {
    // Garde-fou : jamais une page sociale ou une URL invalide comme base d'API.
    const problem = apiBaseProblem(v.key, v.value);
    if (problem) {
      results.push({ key: v.key, ok: false, error: problem });
      continue;
    }
    try {
      await VercelApiService.createEnvVar({
        key: v.key,
        value: v.value,
        target: ['production'],
        type: v.type,
      });
      results.push({ key: v.key, ok: true });
    } catch (err) {
      results.push({ key: v.key, ok: false, error: (err as Error).message });
    }
  }

  await db.auditLog.create({
    data: {
      userId: admin.id,
      action: 'env.batch-upsert',
      resource: 'vercel_env',
      metadata: { count: body.vars.length, keys: body.vars.map((v) => v.key) } as never,
    },
  });

  let deployment: { id?: string; url?: string } | undefined;
  if (body.redeploy && results.every((r) => r.ok)) {
    try {
      deployment = await VercelApiService.redeployFromGit();
    } catch (err) {
      deployment = { id: undefined, url: undefined };
      results.push({ key: '__redeploy__', ok: false, error: (err as Error).message });
    }
  }

  return ok({
    results,
    allOk: results.every((r) => r.ok),
    deployment,
  });
});
