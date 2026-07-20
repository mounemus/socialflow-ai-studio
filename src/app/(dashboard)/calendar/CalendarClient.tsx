'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Filter, RefreshCw, Sparkles, Share2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ManualShareDialog } from '@/components/share/ManualShareDialog';

type View = 'month' | 'week' | 'day';

interface Brand { id: string; name: string }
interface SocialAccount { id: string; platform: string; handle: string; brandId: string | null }

interface Schedule {
  id: string;
  scheduledFor: string;
  status: string;
  postId: string;
  postTitle: string;
  postFormat: string;
  brandId: string | null;
  brandName: string | null;
  platform: string;
  handle: string;
  shareMode: 'AUTO' | 'MANUAL' | string;
  manualSharedAt: string | null;
}

const PLATFORM_COLORS: Record<string, string> = {
  INSTAGRAM: 'bg-pink-500 border-pink-600',
  FACEBOOK: 'bg-blue-600 border-blue-700',
  LINKEDIN: 'bg-sky-700 border-sky-800',
  TWITTER: 'bg-slate-900 border-black',
  TIKTOK: 'bg-black border-black',
  YOUTUBE: 'bg-red-600 border-red-700',
  PINTEREST: 'bg-red-700 border-red-800',
};

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'info' | 'destructive' | 'secondary'> = {
  SCHEDULED: 'info',
  QUEUED: 'info',
  PUBLISHING: 'warning',
  UPLOADING: 'warning',
  PROCESSING: 'warning',
  PUBLISHED: 'success',
  SIMULATED: 'warning',
  FAILED: 'destructive',
  ACTION_REQUIRED: 'destructive',
  MANUAL_SHARE_REQUIRED: 'warning',
};

// === Date helpers ===
function startOfMonth(d: Date) { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; }
function endOfMonth(d: Date) { const x = new Date(d.getFullYear(), d.getMonth() + 1, 0); x.setHours(23, 59, 59, 999); return x; }
function startOfWeek(d: Date) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; // Monday=0
  x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x;
}
function endOfWeek(d: Date) { const s = startOfWeek(d); const e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(23, 59, 59, 999); return e; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtDateKey(d: Date) { return d.toISOString().slice(0, 10); }
function isPast(d: Date) { return d < new Date(); }

function getWindowFor(view: View, current: Date): { from: Date; to: Date; cells: Date[] } {
  if (view === 'month') {
    const start = startOfWeek(startOfMonth(current));
    const end = endOfWeek(endOfMonth(current));
    const cells: Date[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) cells.push(new Date(d));
    return { from: start, to: end, cells };
  }
  if (view === 'week') {
    const start = startOfWeek(current);
    const end = endOfWeek(current);
    const cells: Date[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) cells.push(new Date(d));
    return { from: start, to: end, cells };
  }
  // day
  const day = new Date(current); day.setHours(0, 0, 0, 0);
  const end = new Date(current); end.setHours(23, 59, 59, 999);
  return { from: day, to: end, cells: [day] };
}

export function CalendarClient({ brands, socialAccounts }: { brands: Brand[]; socialAccounts: SocialAccount[] }) {
  const [view, setView] = useState<View>('month');
  const [current, setCurrent] = useState<Date>(new Date());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ brandId: '', platform: '', status: '' });
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [manualSharePostId, setManualSharePostId] = useState<string | null>(null);

  const window = useMemo(() => getWindowFor(view, current), [view, current]);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    });
    if (filters.brandId) params.set('brandId', filters.brandId);
    if (filters.platform) params.set('platform', filters.platform);
    if (filters.status) params.set('status', filters.status);
    const res = await fetch(`/api/schedules?${params.toString()}`);
    setLoading(false);
    if (!res.ok) return;
    const { data } = await res.json();
    setSchedules(data.schedules);
  }, [window.from, window.to, filters]);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  // === Drag-drop handlers ===
  function onDragStart(e: React.DragEvent, schedule: Schedule) {
    e.dataTransfer.setData('text/plain', schedule.id);
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: React.DragEvent, dateKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(dateKey);
  }
  function onDragLeave() {
    setDragOverDate(null);
  }
  async function onDrop(e: React.DragEvent, targetDate: Date) {
    e.preventDefault();
    setDragOverDate(null);
    const scheduleId = e.dataTransfer.getData('text/plain');
    if (!scheduleId) return;

    const sched = schedules.find((s) => s.id === scheduleId);
    if (!sched) return;

    // Preserve time of day, change only the date
    const original = new Date(sched.scheduledFor);
    const newDate = new Date(targetDate);
    newDate.setHours(original.getHours(), original.getMinutes(), 0, 0);

    if (sameDay(original, newDate)) return;

    if (sched.status === 'PUBLISHED' || sched.status === 'PUBLISHING') {
      toast.error('Impossible de reprogrammer un post déjà publié');
      return;
    }

    // Optimistic update
    setSchedules((s) => s.map((x) => x.id === scheduleId ? { ...x, scheduledFor: newDate.toISOString() } : x));

    const res = await fetch(`/api/schedules/${scheduleId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledFor: newDate.toISOString() }),
    });
    if (!res.ok) {
      toast.error('Reprogrammation échouée');
      fetchSchedules();
      return;
    }
    toast.success(`Déplacé au ${newDate.toLocaleDateString('fr-FR')}`);
  }

  // === Group by date ===
  const byDate = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    for (const s of schedules) {
      const key = fmtDateKey(new Date(s.scheduledFor));
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [schedules]);

  function navigate(direction: -1 | 1 | 0) {
    if (direction === 0) { setCurrent(new Date()); return; }
    const d = new Date(current);
    if (view === 'month') d.setMonth(d.getMonth() + direction);
    else if (view === 'week') d.setDate(d.getDate() + 7 * direction);
    else d.setDate(d.getDate() + direction);
    setCurrent(d);
  }

  const headerLabel = useMemo(() => {
    if (view === 'month') return current.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    if (view === 'week') {
      const s = startOfWeek(current); const e = endOfWeek(current);
      return `${s.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} → ${e.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return current.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }, [view, current]);

  return (
    <div className="space-y-4">
      {/* ===== HEADER ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <CalendarIcon className="h-6 w-6" />
            Calendrier éditorial
          </h1>
          <p className="text-sm text-muted-foreground">Drag-drop pour reprogrammer. Filtres pour focus.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View switcher */}
          <div className="flex rounded-md border bg-white text-xs">
            {(['month', 'week', 'day'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  view === v ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                {v === 'month' ? 'Mois' : v === 'week' ? 'Semaine' : 'Jour'}
              </button>
            ))}
          </div>
          {/* Nav */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => navigate(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => navigate(0)}>Aujourd'hui</Button>
            <Button variant="outline" size="icon" onClick={() => navigate(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <Button variant="outline" size="icon" onClick={fetchSchedules} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* ===== PERIOD LABEL + FILTERS ===== */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
          <h2 className="text-lg font-semibold capitalize">{headerLabel}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <select
              className="rounded-md border bg-white px-2 py-1 text-xs"
              value={filters.brandId}
              onChange={(e) => setFilters({ ...filters, brandId: e.target.value })}
            >
              <option value="">Toutes marques</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select
              className="rounded-md border bg-white px-2 py-1 text-xs"
              value={filters.platform}
              onChange={(e) => setFilters({ ...filters, platform: e.target.value })}
            >
              <option value="">Toutes plateformes</option>
              {['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              className="rounded-md border bg-white px-2 py-1 text-xs"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Tous statuts</option>
              {['SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'SIMULATED', 'FAILED', 'ACTION_REQUIRED'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Link href="/ai-studio">
              <Button variant="brand" size="sm">
                <Sparkles className="mr-1 h-3 w-3" /> Nouvelle publication
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* ===== CALENDAR VIEWS ===== */}
      {view === 'month' ? (
        <MonthView
          cells={window.cells}
          current={current}
          byDate={byDate}
          dragOverDate={dragOverDate}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          socialAccounts={socialAccounts}
          onManualShare={setManualSharePostId}
        />
      ) : view === 'week' ? (
        <WeekView
          cells={window.cells}
          byDate={byDate}
          dragOverDate={dragOverDate}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          socialAccounts={socialAccounts}
          onManualShare={setManualSharePostId}
        />
      ) : (
        <DayView
          day={current}
          schedules={byDate.get(fmtDateKey(current)) ?? []}
          socialAccounts={socialAccounts}
          onManualShare={setManualSharePostId}
        />
      )}

      {/* ===== MANUAL-SHARE DIALOG ===== */}
      <ManualShareDialog
        postId={manualSharePostId ?? ''}
        open={manualSharePostId !== null}
        onClose={() => setManualSharePostId(null)}
        onShared={() => { setManualSharePostId(null); fetchSchedules(); }}
      />

      {/* ===== LEGEND ===== */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Légende:</span>
        {Object.entries(PLATFORM_COLORS).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <span className={cn('h-2 w-2 rounded-full', v.split(' ')[0])} />
            {k}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <Share2 className="h-3 w-3 text-orange-500" />
          Partage manuel
        </span>
        <span className="ml-3">·</span>
        <span>{schedules.length} programmation{schedules.length > 1 ? 's' : ''} sur la période</span>
      </div>
    </div>
  );
}

// =====================================================================
// MONTH VIEW
// =====================================================================
function MonthView({
  cells, current, byDate, dragOverDate, onDragStart, onDragOver, onDragLeave, onDrop, onManualShare,
}: {
  cells: Date[];
  current: Date;
  byDate: Map<string, Schedule[]>;
  dragOverDate: string | null;
  onDragStart: (e: React.DragEvent, s: Schedule) => void;
  onDragOver: (e: React.DragEvent, dk: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, d: Date) => void;
  socialAccounts: SocialAccount[];
  onManualShare: (postId: string) => void;
}) {
  const today = new Date();
  return (
    <div className="rounded-lg border bg-white">
      <div className="grid grid-cols-7 border-b bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
          <div key={d} className="px-2 py-2 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const dateKey = fmtDateKey(cell);
          const items = byDate.get(dateKey) ?? [];
          const isCurrentMonth = cell.getMonth() === current.getMonth();
          const isToday = sameDay(cell, today);
          const isDragOver = dragOverDate === dateKey;
          return (
            <div
              key={dateKey}
              onDragOver={(e) => onDragOver(e, dateKey)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, cell)}
              className={cn(
                'min-h-[110px] border-b border-r p-1.5 transition-colors',
                !isCurrentMonth && 'bg-slate-50/50 text-slate-400',
                isDragOver && 'bg-brand-50 ring-2 ring-brand-400 ring-inset',
                isPast(cell) && !isToday && 'bg-slate-50/30',
              )}
            >
              <div className={cn(
                'mb-1 flex items-center justify-between text-xs font-medium',
                isToday && 'text-brand-700',
              )}>
                <span className={cn(isToday && 'flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white')}>
                  {cell.getDate()}
                </span>
                {items.length > 0 ? (
                  <span className="text-[10px] text-muted-foreground">{items.length}</span>
                ) : null}
              </div>
              <div className="space-y-1">
                {items.slice(0, 3).map((s) => <ScheduleChip key={s.id} schedule={s} onDragStart={onDragStart} onManualShare={onManualShare} compact />)}
                {items.length > 3 ? (
                  <div className="text-[10px] text-muted-foreground pl-1">+{items.length - 3} de plus</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// WEEK VIEW
// =====================================================================
function WeekView({
  cells, byDate, dragOverDate, onDragStart, onDragOver, onDragLeave, onDrop, onManualShare,
}: {
  cells: Date[];
  byDate: Map<string, Schedule[]>;
  dragOverDate: string | null;
  onDragStart: (e: React.DragEvent, s: Schedule) => void;
  onDragOver: (e: React.DragEvent, dk: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, d: Date) => void;
  socialAccounts: SocialAccount[];
  onManualShare: (postId: string) => void;
}) {
  const today = new Date();
  return (
    <div className="grid grid-cols-7 gap-2">
      {cells.map((cell) => {
        const dateKey = fmtDateKey(cell);
        const items = byDate.get(dateKey) ?? [];
        const isToday = sameDay(cell, today);
        const isDragOver = dragOverDate === dateKey;
        return (
          <div
            key={dateKey}
            onDragOver={(e) => onDragOver(e, dateKey)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, cell)}
            className={cn(
              'min-h-[400px] rounded-lg border bg-white p-2 transition-colors',
              isDragOver && 'border-brand-400 bg-brand-50',
            )}
          >
            <div className={cn(
              'mb-2 flex items-center justify-between',
              isToday && 'text-brand-700',
            )}>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {cell.toLocaleDateString('fr-FR', { weekday: 'short' })}
              </div>
              <div className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                isToday ? 'bg-brand-600 text-white' : 'text-slate-700',
              )}>
                {cell.getDate()}
              </div>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <div className="text-center text-[10px] text-muted-foreground pt-4">—</div>
              ) : (
                items.map((s) => <ScheduleChip key={s.id} schedule={s} onDragStart={onDragStart} onManualShare={onManualShare} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// DAY VIEW
// =====================================================================
function DayView({ day, schedules, socialAccounts, onManualShare }: { day: Date; schedules: Schedule[]; socialAccounts: SocialAccount[]; onManualShare: (postId: string) => void }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const byHour = new Map<number, Schedule[]>();
  for (const s of schedules) {
    const h = new Date(s.scheduledFor).getHours();
    const arr = byHour.get(h) ?? [];
    arr.push(s);
    byHour.set(h, arr);
  }

  return (
    <div className="rounded-lg border bg-white">
      <div className="grid grid-cols-[60px_1fr] divide-x">
        <div className="bg-slate-50">
          {hours.map((h) => (
            <div key={h} className="flex h-16 items-start justify-end px-2 pt-1 text-[10px] text-slate-500">
              {h.toString().padStart(2, '0')}:00
            </div>
          ))}
        </div>
        <div>
          {hours.map((h) => {
            const items = byHour.get(h) ?? [];
            return (
              <div key={h} className="flex h-16 items-start gap-1 border-b px-2 py-1 last:border-b-0">
                {items.length === 0 ? null : items.map((s) => (
                  <div key={s.id} className="max-w-xs">
                    <ScheduleChip schedule={s} onDragStart={() => {}} onManualShare={onManualShare} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// SCHEDULE CHIP
// =====================================================================
function ScheduleChip({
  schedule, onDragStart, onManualShare, compact,
}: {
  schedule: Schedule;
  onDragStart: (e: React.DragEvent, s: Schedule) => void;
  onManualShare: (postId: string) => void;
  compact?: boolean;
}) {
  const color = PLATFORM_COLORS[schedule.platform] ?? 'bg-slate-500 border-slate-600';
  const time = new Date(schedule.scheduledFor).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const draggable = schedule.status !== 'PUBLISHED' && schedule.status !== 'PUBLISHING';
  const isManual = schedule.shareMode === 'MANUAL';

  const inner = (
    <div
      draggable={draggable}
      onDragStart={(e) => onDragStart(e, schedule)}
      className={cn(
        'rounded border-l-2 bg-white p-1.5 text-[10px] shadow-sm transition-shadow hover:shadow-md',
        color.split(' ')[1], // border color
        isManual && 'border-l-orange-500 border-2 border-orange-300 bg-orange-50/60',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer opacity-75',
      )}
      title={
        isManual
          ? `${schedule.postTitle} — Partage manuel`
          : `${schedule.postTitle} — ${schedule.platform} @${schedule.handle}`
      }
    >
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 font-semibold">
          {isManual ? <Share2 className="h-3 w-3 text-orange-600" /> : null}
          {time}
        </span>
        <Badge
          variant={isManual ? 'warning' : (STATUS_VARIANTS[schedule.status] ?? 'secondary')}
          className="text-[9px] px-1 py-0"
        >
          {isManual
            ? (schedule.manualSharedAt ? '✓' : 'M')
            : schedule.status === 'SCHEDULED' ? 'OK'
            : schedule.status === 'PUBLISHED' ? '✓'
            : schedule.status === 'FAILED' ? '×'
            : schedule.status[0]}
        </Badge>
      </div>
      <div className="line-clamp-2 mt-0.5 font-medium">{schedule.postTitle}</div>
      {!compact ? (
        <div className="mt-0.5 text-[9px] text-muted-foreground">
          {isManual ? 'Manuel' : schedule.platform} · {schedule.brandName ?? 'sans marque'}
        </div>
      ) : null}
    </div>
  );

  if (isManual) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onManualShare(schedule.postId); }}
        className="block w-full text-left"
      >
        {inner}
      </button>
    );
  }

  return <Link href={`/posts/${schedule.postId}`}>{inner}</Link>;
}
