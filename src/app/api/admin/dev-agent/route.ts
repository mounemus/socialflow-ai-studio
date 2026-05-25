import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireSuperAdmin } from '@/lib/admin';
import { DevAgent } from '@/services/agent/DevAgent';
import { db } from '@/lib/db';

const schema = z.object({
  instruction: z.string().min(20),
  context: z.string().optional(),
});

export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin();
  const body = schema.parse(await req.json());

  if (!DevAgent.isConfigured()) {
    return ok({
      configured: false,
      message: 'Configure GITHUB_TOKEN, GITHUB_REPO et ANTHROPIC_API_KEY dans /admin/api-keys.',
    });
  }

  const result = await DevAgent.propose(body.instruction, body.context);
  await db.auditLog.create({
    data: {
      userId: admin.id,
      action: 'dev-agent.propose',
      resource: 'github_pr',
      resourceId: result.prUrl,
      metadata: { instruction: body.instruction.slice(0, 500) } as never,
    },
  });
  return ok({ configured: true, ...result });
});
