import Link from 'next/link';
import { Calendar as CalendarIcon, Share2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

export interface UpcomingScheduleRow {
  id: string;
  scheduledFor: string;
  platform: string;
  brandName: string | null;
  postTitle: string;
  shareMode: 'AUTO' | 'MANUAL' | string;
}

function fmtDayKey(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function UpcomingWeekPanel({
  schedules,
}: {
  schedules: UpcomingScheduleRow[];
}) {
  // group by day-key, preserving order
  const groups = new Map<string, UpcomingScheduleRow[]>();
  for (const s of schedules) {
    const key = fmtDayKey(s.scheduledFor);
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-brand-600" />
            Cette semaine
          </CardTitle>
          <CardDescription>
            {schedules.length > 0
              ? `${schedules.length} publication${schedules.length > 1 ? 's' : ''} programmée${schedules.length > 1 ? 's' : ''}`
              : 'Rien de programmé'}
          </CardDescription>
        </div>
        <Link href="/calendar">
          <Button variant="outline" size="sm">
            Calendrier
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {schedules.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon className="h-8 w-8" />}
            title="Rien de programmé cette semaine"
            description="Programme une publication ou démarre un pipeline."
            action={
              <Link href="/ai-studio">
                <Button variant="brand" size="sm">
                  Studio IA
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            {Array.from(groups.entries()).map(([day, items]) => (
              <div key={day}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {day}
                </div>
                <ul className="divide-y rounded-md border">
                  {items.map((s) => {
                    const isManual = s.shareMode === 'MANUAL';
                    return (
                      <li key={s.id}>
                        <Link
                          href="/calendar"
                          className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-slate-50"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {fmtTime(s.scheduledFor)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">
                                {s.postTitle}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {s.platform} · {s.brandName ?? 'Sans marque'}
                              </div>
                            </div>
                          </div>
                          {isManual ? (
                            <Badge
                              className="shrink-0 border-transparent bg-orange-100 text-orange-800"
                            >
                              <Share2 className="mr-1 h-3 w-3" />
                              MANUAL
                            </Badge>
                          ) : (
                            <Badge variant="info" className="shrink-0 text-[10px]">
                              AUTO
                            </Badge>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
