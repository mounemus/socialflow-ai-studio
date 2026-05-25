/**
 * ClaudeAgentService — drives a multi-turn conversation with Claude that can call our internal tools.
 *
 * Modes:
 *   ASSISTANT — user-facing chat (single turn or short conversation)
 *   OPERATOR  — autonomous run from a prompt template (no user in the loop)
 *   DEV       — special mode: gathers context and proposes a GitHub PR (see DevAgent)
 *
 * Returns the full message trace + tool calls for audit/replay.
 *
 * Falls back to a friendly mock if ANTHROPIC_API_KEY is missing — so the UI works
 * even before the key is configured.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ExternalApiError } from '@/lib/errors';
import { ALL_TOOLS, toolsForClaude, getToolByName } from './tools';
import type { TenantContext } from '@/lib/tenant';
import type { AgentKind } from '@prisma/client';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MAX_TURNS = 10;

type AnthropicTextBlock = { type: 'text'; text: string };
type AnthropicToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type AnthropicToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

type AnthropicMessage =
  | { role: 'user'; content: string | AnthropicContentBlock[] }
  | { role: 'assistant'; content: AnthropicContentBlock[] };

interface RunOptions {
  kind: AgentKind;
  title?: string;
  systemPrompt: string;
  userPrompt: string;
  ctx: TenantContext;
  maxTurns?: number;
  toolsWhitelist?: string[];
}

export const ClaudeAgentService = {
  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  },

  async run(opts: RunOptions): Promise<{ runId: string; finalText: string; turns: number; tokensIn: number; tokensOut: number; mocked: boolean }> {
    const run = await db.agentRun.create({
      data: {
        organizationId: opts.ctx.organizationId,
        userId: opts.ctx.userId,
        kind: opts.kind,
        status: 'RUNNING',
        title: opts.title,
        input: { systemPrompt: opts.systemPrompt, userPrompt: opts.userPrompt } as never,
        messages: [] as never,
        startedAt: new Date(),
      },
    });

    try {
      if (!this.isConfigured()) {
        const mockedReply = this.mockReply(opts);
        await db.agentRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCESS',
            finishedAt: new Date(),
            output: { text: mockedReply, mocked: true } as never,
          },
        });
        return { runId: run.id, finalText: mockedReply, turns: 0, tokensIn: 0, tokensOut: 0, mocked: true };
      }

      const result = await this.runReal(run.id, opts);
      await db.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          output: { text: result.finalText } as never,
          inputTokens: result.tokensIn,
          outputTokens: result.tokensOut,
        },
      });
      return { runId: run.id, ...result, mocked: false };
    } catch (err) {
      logger.error('Agent run failed', { runId: run.id, err: (err as Error).message });
      await db.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: (err as Error).message,
        },
      });
      throw err;
    }
  },

  async runReal(runId: string, opts: RunOptions): Promise<{ finalText: string; turns: number; tokensIn: number; tokensOut: number }> {
    const allowedTools = opts.toolsWhitelist
      ? ALL_TOOLS.filter((t) => opts.toolsWhitelist!.includes(t.name))
      : ALL_TOOLS;
    const tools = allowedTools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

    const conversation: AnthropicMessage[] = [{ role: 'user', content: opts.userPrompt }];
    let totalIn = 0;
    let totalOut = 0;
    let turn = 0;
    const maxTurns = opts.maxTurns ?? MAX_TURNS;

    while (turn < maxTurns) {
      turn++;
      const response = await this.callAnthropic({
        system: opts.systemPrompt,
        messages: conversation,
        tools,
      });
      totalIn += response.usage?.input_tokens ?? 0;
      totalOut += response.usage?.output_tokens ?? 0;

      conversation.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
        const finalText = response.content
          .filter((b): b is AnthropicTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        await db.agentRun.update({
          where: { id: runId },
          data: { messages: conversation as never },
        });
        return { finalText, turns: turn, tokensIn: totalIn, tokensOut: totalOut };
      }

      const toolResults: AnthropicToolResultBlock[] = [];
      for (const tu of toolUses) {
        const tool = getToolByName(tu.name);
        const start = Date.now();
        if (!tool || (opts.toolsWhitelist && !opts.toolsWhitelist.includes(tu.name))) {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({ error: 'tool not available' }), is_error: true });
          continue;
        }
        try {
          const out = await tool.run(tu.input, opts.ctx);
          const json = JSON.stringify(out).slice(0, 8000);
          await db.agentTask.create({
            data: {
              agentRunId: runId,
              order: turn,
              toolName: tu.name,
              input: tu.input as never,
              output: { result: out } as never,
              durationMs: Date.now() - start,
              success: true,
            },
          });
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: json });
        } catch (err) {
          await db.agentTask.create({
            data: {
              agentRunId: runId,
              order: turn,
              toolName: tu.name,
              input: tu.input as never,
              durationMs: Date.now() - start,
              success: false,
              errorMessage: (err as Error).message,
            },
          });
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({ error: (err as Error).message }), is_error: true });
        }
      }
      conversation.push({ role: 'user', content: toolResults });
    }

    await db.agentRun.update({ where: { id: runId }, data: { messages: conversation as never } });
    return { finalText: 'Max turns reached without final answer', turns: turn, tokensIn: totalIn, tokensOut: totalOut };
  },

  async callAnthropic(args: { system: string; messages: AnthropicMessage[]; tools: { name: string; description: string; input_schema: unknown }[] }): Promise<{
    content: AnthropicContentBlock[];
    stop_reason: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  }> {
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: args.system,
        messages: args.messages,
        tools: args.tools,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new ExternalApiError('anthropic', `${res.status} ${txt}`);
    }
    return res.json();
  },

  mockReply(opts: RunOptions): string {
    return [
      `[MOCK Claude — ANTHROPIC_API_KEY non configurée]`,
      ``,
      `J'ai bien compris ta demande : "${opts.userPrompt.slice(0, 200)}"`,
      ``,
      `En mode réel, j'utiliserais ces outils pour répondre :`,
      ...toolsForClaude().slice(0, 5).map((t) => `  • ${t.name} — ${t.description}`),
      ``,
      `Configure ANTHROPIC_API_KEY dans /admin/api-keys pour activer le vrai assistant.`,
    ].join('\n');
  },
};
