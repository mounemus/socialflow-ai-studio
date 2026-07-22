import { z } from 'zod';
import { handle, ok, created } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { VercelApiService } from '@/services/vercel/VercelApiService';
import { apiBaseProblem } from '@/lib/env-guard';
import { db } from '@/lib/db';

const createSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  target: z.array(z.enum(['production', 'preview', 'development'])).default(['production']),
  type: z.enum(['plain', 'encrypted', 'sensitive']).default('encrypted'),
});

export const GET = handle(async () => {
  await requireSuperAdmin();
  if (!VercelApiService.isConfigured()) {
    return ok({ configured: false, envs: [] });
  }
  const envs = await VercelApiService.listEnvVars(false);
  return ok({ configured: true, envs });
});

export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin();
  const body = createSchema.parse(await req.json());

  // Garde-fou : jamais une page sociale ou une URL invalide comme base d'API.
  const problem = apiBaseProblem(body.key, body.value);
  if (problem) {
    return new Response(JSON.stringify({ success: false, message: problem }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const env = await VercelApiService.createEnvVar(body);

  await db.auditLog.create({
    data: {
      userId: admin.id,
      action: 'env.upsert',
      resource: 'vercel_env',
      resourceId: env.id,
      metadata: { key: body.key, targets: body.target } as never,
    },
  });

  return created(env);
});
