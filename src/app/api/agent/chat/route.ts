import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { ClaudeAgentService } from '@/services/agent/ClaudeAgentService';

const schema = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().optional(),
});

const SYSTEM_PROMPT = `Tu es l'assistant IA de SocialFlow AI Studio, une plateforme SaaS de marketing social multi-marques.

Tu aides l'utilisateur (entrepreneur, créateur, agence marketing) à :
- générer du contenu adapté à chaque plateforme sociale
- planifier des publications
- créer des briefs Canva
- analyser les tendances et concurrents
- coordonner des campagnes

Tu as accès à des OUTILS pour interagir avec la base de données et les services internes.
Utilise-les chaque fois que c'est pertinent — ne demande pas la permission, agis.
Quand un outil retourne des IDs (brandId, postId, socialAccountId), réutilise-les dans les outils suivants.

Réponds toujours en français sauf si l'utilisateur écrit en anglais.
Sois concis et orienté action. Termine par un récap de ce que tu as fait.`;

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  const result = await ClaudeAgentService.run({
    kind: 'ASSISTANT',
    title: body.message.slice(0, 60),
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: body.message,
    ctx,
    maxTurns: 8,
  });

  return ok(result);
});
