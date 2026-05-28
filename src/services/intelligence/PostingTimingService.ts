/**
 * PostingTimingService — suggests optimal posting slots per platform/brand/audience.
 *
 * Strategy:
 *   1. Start from PLATFORM_DEFAULTS (industry-validated heuristics).
 *   2. Adjust by audience timezone (from brand profile).
 *   3. If we have analytics history -> override with empirical best slots
 *      (top engagement quartile by weekday × hour).
 *   4. Avoid collision with existing scheduled posts (spacing > minGapMinutes).
 *
 * Output: an ordered list of next N slots with rationale + confidence.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface TimeSlot {
  iso: string;            // ISO datetime of the suggested slot
  weekday: Weekday;
  hour: number;
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
  source: 'empirical' | 'platform-default' | 'audience-tz-adjusted';
}

// Platform-validated defaults (UTC, will be shifted to local TZ).
// Format: { weekday: [hours...] }
const PLATFORM_DEFAULTS: Record<string, Record<number, number[]>> = {
  INSTAGRAM: {
    1: [11, 14, 19], 2: [11, 14, 19], 3: [11, 14, 20], 4: [11, 14, 20],
    5: [10, 14, 18], 6: [10, 13], 0: [11, 17],
  },
  FACEBOOK: {
    1: [9, 13, 15], 2: [9, 13, 15], 3: [9, 13, 15], 4: [9, 13, 15],
    5: [9, 13], 6: [12], 0: [12, 16],
  },
  LINKEDIN: {
    1: [8, 12, 17], 2: [8, 10, 12, 17], 3: [8, 10, 12, 17], 4: [8, 12, 17],
    5: [8, 12], 6: [], 0: [],
  },
  TWITTER: {
    1: [8, 12, 17, 21], 2: [8, 12, 17, 21], 3: [8, 12, 17, 21], 4: [8, 12, 17, 21],
    5: [8, 12, 17], 6: [10, 14], 0: [10, 14],
  },
  TIKTOK: {
    1: [6, 10, 22], 2: [9, 19], 3: [7, 8, 11, 17], 4: [9, 12, 19, 20], 5: [5, 13, 15],
    6: [11], 0: [7, 8, 16],
  },
  YOUTUBE: {
    1: [], 2: [], 3: [17], 4: [16], 5: [15], 6: [9, 11], 0: [9, 11],
  },
  PINTEREST: {
    1: [20], 2: [20], 3: [20], 4: [20], 5: [20, 21], 6: [20, 21], 0: [20, 21],
  },
};

export interface SuggestSlotsInput {
  brandId?: string;
  platform: string;
  startFrom?: Date;
  count?: number; // how many slots to return (default 5)
  audienceTimezoneOffsetMinutes?: number; // e.g. +60 for Europe/Paris winter
  minGapMinutes?: number;                 // avoid stacking; default 120
}

export const PostingTimingService = {
  async suggestSlots(input: SuggestSlotsInput): Promise<TimeSlot[]> {
    const platform = input.platform.toUpperCase();
    const count = input.count ?? 5;
    const start = input.startFrom ?? new Date();
    const tzShift = input.audienceTimezoneOffsetMinutes ?? 0;
    const minGap = input.minGapMinutes ?? 120;

    const empirical = input.brandId ? await this.empiricalTopSlots(input.brandId, platform) : new Map();
    const occupied = input.brandId ? await this.occupiedSlots(input.brandId, platform, start) : [];

    const out: TimeSlot[] = [];
    const cursor = new Date(start);
    cursor.setMinutes(0, 0, 0);
    // Look ahead up to 14 days
    for (let dayIdx = 0; dayIdx < 14 && out.length < count; dayIdx++) {
      const day = new Date(cursor);
      day.setDate(cursor.getDate() + dayIdx);
      const weekday = day.getDay() as Weekday;

      // Pull empirical first, then defaults, then dedupe
      const empHours = empirical.get(weekday) ?? [];
      const defHours = PLATFORM_DEFAULTS[platform]?.[weekday] ?? [];
      const merged = Array.from(new Set([...empHours, ...defHours]));

      for (const localHour of merged) {
        // Shift by audience TZ to convert local target -> server UTC hour
        const utcHour = ((localHour - Math.floor(tzShift / 60)) + 24) % 24;
        const candidate = new Date(day);
        candidate.setHours(utcHour, 0, 0, 0);
        if (candidate.getTime() <= start.getTime()) continue;

        // Spacing check
        const tooClose = [...occupied, ...out.map((s) => new Date(s.iso))].some((d) =>
          Math.abs(d.getTime() - candidate.getTime()) < minGap * 60_000
        );
        if (tooClose) continue;

        const isEmpirical = empHours.includes(localHour);
        out.push({
          iso: candidate.toISOString(),
          weekday,
          hour: localHour,
          rationale: isEmpirical
            ? `Tes posts à ${localHour}h le ${weekdayName(weekday)} performent dans le top quartile.`
            : `Créneau standard ${platform} pour le ${weekdayName(weekday)}.`,
          confidence: isEmpirical ? 'high' : 'medium',
          source: isEmpirical ? 'empirical' : (tzShift !== 0 ? 'audience-tz-adjusted' : 'platform-default'),
        });
        if (out.length >= count) break;
      }
    }
    return out;
  },

  /**
   * Empirical top slots from analytics — weekday → hours where engagement was in top quartile.
   */
  async empiricalTopSlots(brandId: string, platform: string): Promise<Map<number, number[]>> {
    try {
      // Pull schedules with published posts that have analytics
      const analytics = await db.postAnalytics.findMany({
        where: {
          post: { brandId },
          socialAccount: { platform: platform as never },
        },
        select: {
          likes: true,
          comments: true,
          shares: true,
          clicks: true,
          postSchedule: { select: { scheduledFor: true, publishedAt: true } },
        },
        take: 200,
      });
      if (analytics.length < 10) return new Map();

      // Score = engagement (likes + comments*3 + shares*5) — heuristic
      const scored = analytics.map((a) => {
        const score = (a.likes ?? 0) + (a.comments ?? 0) * 3 + (a.shares ?? 0) * 5 + (a.clicks ?? 0) * 2;
        const when = a.postSchedule?.publishedAt ?? a.postSchedule?.scheduledFor;
        return { score, when };
      }).filter((x) => x.when);

      scored.sort((a, b) => b.score - a.score);
      const topQuartile = scored.slice(0, Math.max(5, Math.floor(scored.length / 4)));

      const map = new Map<number, Set<number>>();
      for (const x of topQuartile) {
        const d = x.when as Date;
        const wd = d.getDay();
        const hr = d.getHours();
        if (!map.has(wd)) map.set(wd, new Set());
        map.get(wd)!.add(hr);
      }
      const out = new Map<number, number[]>();
      for (const [wd, set] of map) out.set(wd, Array.from(set).sort((a, b) => a - b));
      return out;
    } catch (err) {
      logger.warn('empiricalTopSlots failed', { err: (err as Error).message });
      return new Map();
    }
  },

  /**
   * Already-scheduled slots — to avoid collision.
   */
  async occupiedSlots(brandId: string, platform: string, from: Date): Promise<Date[]> {
    try {
      const schedules = await db.postSchedule.findMany({
        where: {
          post: { brandId },
          socialAccount: { platform: platform as never },
          scheduledFor: { gte: from },
        },
        select: { scheduledFor: true },
      });
      return schedules.map((s) => s.scheduledFor);
    } catch {
      return [];
    }
  },
};

function weekdayName(w: number): string {
  return ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][w];
}
