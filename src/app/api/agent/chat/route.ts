import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { db } from '@/lib/db';
import { ClaudeAgentService, condenseAgentMessages } from '@/services/agent/ClaudeAgentService';

const schema = z.object({
  message: z.string().min(1).max(8000),
  /** runId du tour précédent — la mémoire de conversation vit dans AgentRun.messages (DB). */
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

RÈGLE ABSOLUE SUR LES MARQUES :
- Ne DEVINE JAMAIS la marque cible. N'utilise une marque que si (a) l'utilisateur l'a
  nommée explicitement dans ce message, ou (b) elle est clairement désignée dans
  l'historique de CETTE conversation (marque créée ou choisie précédemment).
- Si l'utilisateur dit "cette marque", c'est TOUJOURS la dernière marque mentionnée
  dans la conversation — jamais une autre.
- En cas de doute, appelle list_brands et DEMANDE à l'utilisateur de confirmer AVANT
  de générer quoi que ce soit. Générer du contenu pour la mauvaise marque est une
  faute grave.

Réponds toujours en français sauf si l'utilisateur écrit en anglais.
Sois concis et orienté action. Termine par un récap de ce que tu as fait.`;

export const POST = handle(async (req) => {
  const ctx = await requireTenant();
  requirePermission(ctx.role, 'ai.use');
  const body = schema.parse(await req.json());

  // Mémoire de conversation : rechargée depuis la DB (AgentRun du tour
  // précédent, scopé organisation) — Claude n'est jamais la seule mémoire.
  let history: { role: 'user' | 'assistant'; content: string }[] = [];
  if (body.conversationId) {
    const prev = await db.agentRun.findFirst({
      where: { id: body.conversationId, organizationId: ctx.organizationId, kind: 'ASSISTANT' },
      select: { messages: true, input: true, output: true },
    });
    if (prev) {
      history = condenseAgentMessages(prev.messages);
      if (history.length === 0) {
        // Run mock ou trace vide : reconstruire depuis input/output.
        const input = prev.input as { userPrompt?: string } | null;
        const output = prev.output as { text?: string } | null;
        if (input?.userPrompt) history.push({ role: 'user', content: input.userPrompt });
        if (output?.text) history.push({ role: 'assistant', content: output.text });
      }
    }
  }

  const result = await ClaudeAgentService.run({
    kind: 'ASSISTANT',
    title: body.message.slice(0, 60),
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: body.message,
    ctx,
    maxTurns: 8,
    history,
  });

  // Le runId retourné sert de conversationId pour le tour suivant.
  return ok({ ...result, conversationId: result.runId });
});
