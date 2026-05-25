/**
 * OperatorAgent — runs autonomously from a saved schedule.
 * Reads AgentSchedule, builds a prompt with current org context, and lets Claude work.
 *
 * Triggers:
 *   - Manual: POST /api/admin/agent/schedules/:id/run
 *   - Cron tick: GET /api/cron/agent-tick (Vercel Cron, every 5 min)
 */
import { db } from '@/lib/db';
import { ClaudeAgentService } from './ClaudeAgentService';
import type { TenantContext } from '@/lib/tenant';

const OPERATOR_SYSTEM_PROMPT = `Tu es l'agent opérateur autonome de SocialFlow AI Studio.
Tu travailles SANS interaction humaine pour une organisation donnée.

Mission selon le contexte fourni :
- Faire la veille marketing automatique (run_marketing_watch puis list_recent_trends)
- Générer des publications de qualité (generate_post avec saveAsDraft=true)
- Préparer le calendrier hebdomadaire (generate_calendar)
- Analyser les concurrents périodiquement (analyze_competitor)

Règles :
- Utilise les outils sans demander de permission
- Sois économe : ne fais que ce qui est demandé par le promptTemplate
- Termine par un résumé bullet-point de ce que tu as fait
- En cas d'erreur sur un outil, continue avec les autres au lieu de t'arrêter`;

export const OperatorAgent = {
  /**
   * Compute the next run time based on a simple frequency token.
   * Supported: "hourly", "every:6h", "daily:09:00", "weekly:mon:09:00".
   */
  computeNextRun(cronExpression: string, from: Date = new Date()): Date {
    const now = new Date(from);
    if (cronExpression === 'hourly') {
      const d = new Date(now);
      d.setHours(d.getHours() + 1, 0, 0, 0);
      return d;
    }
    const everyMatch = cronExpression.match(/^every:(\d+)([hm])$/);
    if (everyMatch) {
      const n = parseInt(everyMatch[1], 10);
      const ms = everyMatch[2] === 'h' ? n * 3600_000 : n * 60_000;
      return new Date(now.getTime() + ms);
    }
    const dailyMatch = cronExpression.match(/^daily:(\d{2}):(\d{2})$/);
    if (dailyMatch) {
      const d = new Date(now);
      d.setHours(parseInt(dailyMatch[1], 10), parseInt(dailyMatch[2], 10), 0, 0);
      if (d <= now) d.setDate(d.getDate() + 1);
      return d;
    }
    const weeklyMatch = cronExpression.match(/^weekly:(mon|tue|wed|thu|fri|sat|sun):(\d{2}):(\d{2})$/);
    if (weeklyMatch) {
      const days = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      const target = days[weeklyMatch[1] as keyof typeof days];
      const d = new Date(now);
      d.setHours(parseInt(weeklyMatch[2], 10), parseInt(weeklyMatch[3], 10), 0, 0);
      while (d.getDay() !== target || d <= now) d.setDate(d.getDate() + 1);
      return d;
    }
    // Unknown — default to 1 day from now to avoid infinite loops
    return new Date(now.getTime() + 86_400_000);
  },

  async runScheduleById(scheduleId: string, manualUserId?: string) {
    const schedule = await db.agentSchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) throw new Error('Schedule not found');
    const orgMembership = await db.teamMember.findFirst({
      where: { organizationId: schedule.organizationId, role: { in: ['OWNER', 'ADMIN'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!orgMembership) throw new Error('No owner found for this org');

    const ctx: TenantContext = {
      userId: manualUserId ?? orgMembership.userId,
      organizationId: schedule.organizationId,
      role: 'ADMIN',
    };

    const result = await ClaudeAgentService.run({
      kind: 'OPERATOR',
      title: schedule.name,
      systemPrompt: OPERATOR_SYSTEM_PROMPT,
      userPrompt: schedule.promptTemplate,
      ctx,
      maxTurns: 15,
    });

    await db.agentSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunAt: new Date(),
        nextRunAt: this.computeNextRun(schedule.cronExpression),
      },
    });

    return result;
  },

  /**
   * Cron tick - finds all enabled schedules whose nextRunAt has passed.
   * Called by Vercel Cron.
   */
  async tickAll() {
    const due = await db.agentSchedule.findMany({
      where: {
        enabled: true,
        OR: [{ nextRunAt: { lte: new Date() } }, { nextRunAt: null }],
      },
      take: 10,
    });
    const results = [];
    for (const s of due) {
      try {
        await this.runScheduleById(s.id);
        results.push({ id: s.id, ok: true });
      } catch (err) {
        results.push({ id: s.id, ok: false, error: (err as Error).message });
      }
    }
    return { ran: results.length, results };
  },
};
