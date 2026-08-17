'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Inbox,
  MessageCircle,
  AtSign,
  Send,
  Sparkles,
  Check,
  Archive,
  UserPlus,
  Heart,
  AlertTriangle,
  Settings,
  RefreshCw,
  Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { normalizeInteraction } from '@/lib/inbox-normalize';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type Interaction = {
  id: string;
  platform: string;
  kind: string; // MENTION | DM | COMMENT | REPLY | ...
  fromName: string;
  fromHandle: string | null;
  avatarUrl: string | null;
  content: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | null;
  status: string;
  isUnread: boolean;
  isAutoReplied: boolean;
  receivedAt: string;
  brandId: string | null;
  brandName: string | null;
  postId: string | null;
  postTitle: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  threadId: string | null;
};

export type TeamMemberLite = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
};

type ThreadMessage = {
  id: string;
  fromName: string;
  content: string;
  receivedAt: string;
  isFromUs: boolean;
};

type FilterKey =
  | 'ALL'
  | 'UNREAD'
  | 'MENTION'
  | 'DM'
  | 'EMAIL'
  | 'COMMENT'
  | 'BRAND'
  | 'SENTIMENT_POSITIVE'
  | 'SENTIMENT_NEGATIVE'
  | 'SENTIMENT_NEUTRAL';

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const diffSec = Math.floor((Date.now() - d) / 1000);
  if (diffSec < 60) return "à l'instant";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `il y a ${diffD} j`;
  return new Date(iso).toLocaleDateString('fr-FR');
}

function platformLabel(p: string): string {
  const k = String(p ?? '').toUpperCase();
  if (k.includes('INSTA')) return 'IG';
  if (k.includes('FACEBOOK')) return 'FB';
  if (k.includes('LINKEDIN')) return 'IN';
  if (k.includes('TWITTER') || k === 'X') return 'X';
  if (k.includes('TIKTOK')) return 'TT';
  if (k.includes('YOUTUBE')) return 'YT';
  if (k.includes('WHATSAPP')) return 'WhatsApp';
  if (k.includes('EMAIL')) return 'Email';
  return k.slice(0, 2);
}

/** WhatsApp/Email se distinguent des réseaux sociaux (conversation-only ici). */
function platformBadgeVariant(p: string): 'outline' | 'success' | 'info' {
  const k = String(p ?? '').toUpperCase();
  if (k.includes('WHATSAPP')) return 'success';
  if (k.includes('EMAIL')) return 'info';
  return 'outline';
}

function sentimentClass(s: Interaction['sentiment']): string {
  if (s === 'POSITIVE') return 'bg-emerald-500';
  if (s === 'NEGATIVE') return 'bg-rose-500';
  return 'bg-slate-400';
}

export function InboxClient({
  initialInteractions,
  teamMembers,
}: {
  initialInteractions: Interaction[];
  teamMembers: TeamMemberLite[];
}) {
  const [interactions, setInteractions] = useState<Interaction[]>(initialInteractions);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialInteractions[0]?.id ?? null);
  const [reply, setReply] = useState('');
  const [proposing, setProposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);

  // Brand options (derived)
  const brandOptions = useMemo(() => {
    const m = new Map<string, string>();
    interactions.forEach((i) => {
      if (i.brandId && i.brandName) m.set(i.brandId, i.brandName);
    });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [interactions]);

  // Counters
  const counters = useMemo(() => {
    const c = {
      ALL: interactions.length,
      UNREAD: 0,
      MENTION: 0,
      DM: 0,
      EMAIL: 0,
      COMMENT: 0,
      POS: 0,
      NEG: 0,
      NEU: 0,
    };
    for (const i of interactions) {
      if (i.isUnread) c.UNREAD += 1;
      const k = String(i.kind ?? '').toUpperCase();
      const isEmail = String(i.platform ?? '').toUpperCase() === 'EMAIL';
      if (k.includes('MENTION')) c.MENTION += 1;
      if (isEmail) c.EMAIL += 1;
      else if (k === 'DM' || k.includes('DIRECT')) c.DM += 1;
      if (k.includes('COMMENT')) c.COMMENT += 1;
      if (i.sentiment === 'POSITIVE') c.POS += 1;
      else if (i.sentiment === 'NEGATIVE') c.NEG += 1;
      else c.NEU += 1;
    }
    return c;
  }, [interactions]);

  // Filtered list
  const filtered = useMemo(() => {
    return interactions
      .filter((i) => {
        if (brandFilter && i.brandId !== brandFilter) return false;
        switch (filter) {
          case 'ALL':
            return true;
          case 'UNREAD':
            return i.isUnread;
          case 'MENTION':
            return String(i.kind ?? '').toUpperCase().includes('MENTION');
          case 'DM':
            return (
              String(i.platform ?? '').toUpperCase() !== 'EMAIL' &&
              (String(i.kind ?? '').toUpperCase() === 'DM' ||
                String(i.kind ?? '').toUpperCase().includes('DIRECT'))
            );
          case 'EMAIL':
            return String(i.platform ?? '').toUpperCase() === 'EMAIL';
          case 'COMMENT':
            return String(i.kind ?? '').toUpperCase().includes('COMMENT');
          case 'BRAND':
            return !!i.brandId;
          case 'SENTIMENT_POSITIVE':
            return i.sentiment === 'POSITIVE';
          case 'SENTIMENT_NEGATIVE':
            return i.sentiment === 'NEGATIVE';
          case 'SENTIMENT_NEUTRAL':
            return i.sentiment === 'NEUTRAL' || i.sentiment === null;
          default:
            return true;
        }
      })
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }, [interactions, filter, brandFilter]);

  const selected = useMemo(
    () => filtered.find((i) => i.id === selectedId) ?? interactions.find((i) => i.id === selectedId) ?? null,
    [filtered, interactions, selectedId],
  );

  // Auto-select first when filter/list changes
  useEffect(() => {
    if (!selected && filtered.length > 0) {
      setSelectedId(filtered[0]!.id);
    }
  }, [filtered, selected]);

  // Load thread for selected — GET /api/inbox/[id] renvoie les autres
  // interactions du même threadId (threadInteractions).
  useEffect(() => {
    let cancelled = false;
    const interactionId = selected?.id;
    if (!interactionId || !selected?.threadId) {
      setThread([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/inbox/${encodeURIComponent(interactionId)}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          if (!cancelled) setThread([]);
          return;
        }
        const payload = (await res.json()) as {
          data?: { threadInteractions?: Record<string, unknown>[] };
        };
        const rows = payload.data?.threadInteractions;
        if (!cancelled) {
          setThread(
            Array.isArray(rows)
              ? rows.map((r) => {
                  const n = normalizeInteraction(r);
                  return {
                    id: n.id,
                    fromName: n.fromName,
                    content: n.content,
                    receivedAt: n.receivedAt,
                    isFromUs: false,
                  };
                })
              : [],
          );
        }
      } catch {
        if (!cancelled) setThread([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.threadId]);

  // Polling for new interactions every 30s
  useEffect(() => {
    const tick = async () => {
      try {
        // The list endpoint is GET /api/inbox (returns ok({ interactions, ... })).
        const res = await fetch('/api/inbox?limit=50', { cache: 'no-store' });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          interactions?: Record<string, unknown>[];
          data?: { interactions?: Record<string, unknown>[] };
        };
        const list = payload.data?.interactions ?? payload.interactions;
        if (Array.isArray(list)) {
          // Les lignes API sont des SocialInteraction bruts — même
          // normalisation que l'hydratation serveur.
          setInteractions(list.map(normalizeInteraction));
        }
      } catch {
        // ignore
      }
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-sync silencieuse au montage — même endpoint que le bouton
  // « Synchroniser », mais sans toast d'erreur/vide : les rôles sans la
  // permission post.edit reçoivent un 403 qu'on ignore. Ref = une seule fois
  // par montage (pas à chaque re-render).
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (autoSyncedRef.current) return;
    autoSyncedRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/inbox/sync-now', { method: 'POST' });
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));
        const d = (json?.data ?? json) as { comments?: number; dms?: number; mentions?: number; emails?: number };
        const imported = (d.comments ?? 0) + (d.dms ?? 0) + (d.mentions ?? 0) + (d.emails ?? 0);
        if (imported <= 0) return;
        const list = await fetch('/api/inbox?limit=50', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
        const rows = list?.data?.interactions ?? list?.interactions;
        if (Array.isArray(rows)) setInteractions(rows.map(normalizeInteraction));
        toast.success(`${d.comments ?? 0} commentaire(s), ${d.dms ?? 0} DM, ${d.mentions ?? 0} mention(s) et ${d.emails ?? 0} email(s) importés.`);
      } catch {
        // silencieux — auto-sync best-effort
      }
    })();
  }, []);

  // Reset composer on selection change
  useEffect(() => {
    setReply('');
    setShowAssign(false);
  }, [selectedId]);

  // Synchronisation Zernio à la demande — retour immédiat + raisons de skip.
  const [syncing, setSyncing] = useState(false);
  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/inbox/sync-now', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? `Synchronisation refusée (${res.status})`);
      const d = (json?.data ?? json) as {
        comments?: number; dms?: number; mentions?: number; emails?: number; skipped?: number;
        reasons?: Record<string, number>;
        traces?: Array<{ path: string; status: number; keys: string[]; err?: string }>;
      };
      const imported = (d.comments ?? 0) + (d.dms ?? 0) + (d.mentions ?? 0) + (d.emails ?? 0);
      if (imported > 0) {
        toast.success(`${d.comments ?? 0} commentaire(s), ${d.dms ?? 0} DM, ${d.mentions ?? 0} mention(s) et ${d.emails ?? 0} email(s) importés.`);
      } else {
        // Diagnostic complet seulement si quelque chose a réellement échoué —
        // en fonctionnement normal (« tout est déjà importé »), un mot suffit.
        const reasons = Object.entries(d.reasons ?? {}).map(([k, v]) => `${k}×${v}`).join(', ');
        const failedTraces = (d.traces ?? []).filter((t) => t.status >= 400);
        if (!reasons && failedTraces.length === 0) {
          toast.info('Boîte à jour — aucun nouveau message.');
        } else {
          const traces = failedTraces
            .map((t) => `${t.path}→${t.status}${t.err ? ` ${t.err}` : ''}`)
            .join(' · ');
          toast.info(`Rien à importer.${reasons ? ` Raisons: ${reasons}.` : ''}${traces ? ` API: ${traces}` : ''}`, { duration: 15000 });
        }
      }
      const list = await fetch('/api/inbox?limit=50', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
      const rows = list?.data?.interactions ?? list?.interactions;
      if (Array.isArray(rows)) setInteractions(rows.map(normalizeInteraction));
    } catch (err) {
      toast.error((err as Error).message.slice(0, 160));
    } finally {
      setSyncing(false);
    }
  }, []);

  const updateLocal = useCallback((id: string, patch: Partial<Interaction>) => {
    setInteractions((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const removeLocal = useCallback((id: string) => {
    setInteractions((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // Toutes les mutations passent par PATCH /api/inbox/[id]
  // (schema: { status?, sentiment?, assignedToId? }).
  const patchInteraction = useCallback(async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/inbox/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('patch failed');
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      updateLocal(id, { isUnread: false, status: 'READ' });
      try {
        await patchInteraction(id, { status: 'READ' });
      } catch {
        toast.error('Impossible de marquer comme lu');
      }
    },
    [patchInteraction, updateLocal],
  );

  // Consulter une conversation dans le panneau de lecture = la LIRE : marquage
  // automatique (le serveur marque aussi tout le fil). Sans ça, seul le bouton
  // manuel « Marquer lu » comptait — le badge non-lus ne descendait jamais.
  const selectedIsUnread = selected?.isUnread ?? false;
  const selectedIdForRead = selected?.id ?? null;
  useEffect(() => {
    if (selectedIdForRead && selectedIsUnread) void markRead(selectedIdForRead);
  }, [selectedIdForRead, selectedIsUnread, markRead]);

  /** Purge : marque lues TOUTES les interactions non lues (org + marque active). */
  const [markingAll, setMarkingAll] = useState(false);
  const markAllRead = useCallback(async () => {
    setMarkingAll(true);
    setInteractions((prev) => prev.map((i) => (i.isUnread ? { ...i, isUnread: false, status: 'READ' } : i)));
    try {
      const res = await fetch('/api/inbox/mark-all-read', { method: 'POST' });
      if (!res.ok) throw new Error('échec');
      toast.success('Toutes les conversations sont marquées lues.');
    } catch {
      toast.error('Impossible de tout marquer lu');
    } finally {
      setMarkingAll(false);
    }
  }, []);

  const archive = useCallback(
    async (id: string) => {
      removeLocal(id);
      try {
        await patchInteraction(id, { status: 'ARCHIVED' });
        toast.success('Archivé');
      } catch {
        toast.error("Échec de l'archivage");
      }
    },
    [patchInteraction, removeLocal],
  );

  const assign = useCallback(
    // assignedToId référence un User — on passe le userId du membre.
    async (id: string, memberUserId: string, memberName: string) => {
      updateLocal(id, { assigneeId: memberUserId, assigneeName: memberName });
      setShowAssign(false);
      try {
        await patchInteraction(id, { assignedToId: memberUserId });
        toast.success(`Assigné à ${memberName}`);
      } catch {
        toast.error("Échec de l'assignation");
      }
    },
    [patchInteraction, updateLocal],
  );

  const overrideSentiment = useCallback(
    async (id: string, sentiment: Interaction['sentiment']) => {
      updateLocal(id, { sentiment });
      try {
        await patchInteraction(id, { sentiment: sentiment ?? 'UNKNOWN' });
      } catch {
        toast.error('Échec de la mise à jour du sentiment');
      }
    },
    [patchInteraction, updateLocal],
  );

  const proposeReply = useCallback(async () => {
    if (!selected) return;
    setProposing(true);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(selected.id)}/propose-reply`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('propose failed');
      const payload = (await res.json()) as { data?: { suggestion?: string } };
      const suggestion = payload.data?.suggestion ?? '';
      if (!suggestion) throw new Error('empty suggestion');
      setReply(suggestion);
      replyRef.current?.focus();
    } catch {
      toast.error('Impossible de générer une suggestion');
    } finally {
      setProposing(false);
    }
  }, [selected]);

  const sendReply = useCallback(async () => {
    if (!selected) return;
    if (!reply.trim()) {
      toast.error('La réponse est vide');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(selected.id)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reply }),
      });
      if (!res.ok) throw new Error('reply failed');
      // Le service ne throw jamais : l'échec d'envoi arrive en 200 { posted: false }.
      const payload = (await res.json()) as { data?: { posted?: boolean; error?: string } };
      if (payload.data?.posted === false) throw new Error(payload.data.error ?? 'reply failed');
      toast.success('Réponse envoyée');
      setReply('');
      updateLocal(selected.id, { status: 'REPLIED', isUnread: false });
    } catch {
      toast.error("Échec de l'envoi");
    } finally {
      setSending(false);
    }
  }, [reply, selected, updateLocal]);

  // Keyboard shortcuts: j/k navigate, r reply, e archive, m mark read
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (!filtered.length) return;
      const idx = filtered.findIndex((i) => i.id === selectedId);
      if (ev.key === 'j') {
        ev.preventDefault();
        const next = filtered[Math.min(filtered.length - 1, Math.max(0, idx + 1))];
        if (next) setSelectedId(next.id);
      } else if (ev.key === 'k') {
        ev.preventDefault();
        const prev = filtered[Math.max(0, idx - 1)];
        if (prev) setSelectedId(prev.id);
      } else if (ev.key === 'r') {
        if (!selected) return;
        ev.preventDefault();
        replyRef.current?.focus();
      } else if (ev.key === 'e') {
        if (!selected) return;
        ev.preventDefault();
        void archive(selected.id);
      } else if (ev.key === 'm') {
        if (!selected) return;
        ev.preventDefault();
        void markRead(selected.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selected, selectedId, archive, markRead]);

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-4 p-4">
      {/* LEFT */}
      <aside className="w-[300px] shrink-0">
        <Card className="flex h-full flex-col p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-brand-600" />
              <h2 className="text-lg font-semibold">Boîte de réception</h2>
            </div>
            <Link
              href="/inbox/rules"
              title="Règles d'auto-réponse"
              className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <Settings className="h-4 w-4" />
            </Link>
          </div>
          <nav className="space-y-1 text-sm">
            <FilterRow label="Tous" icon={<Inbox className="h-4 w-4" />} count={counters.ALL} active={filter === 'ALL'} onClick={() => setFilter('ALL')} />
            <FilterRow label="Non lus" icon={<MessageCircle className="h-4 w-4" />} count={counters.UNREAD} active={filter === 'UNREAD'} onClick={() => setFilter('UNREAD')} />
            <FilterRow label="Mentionné" icon={<AtSign className="h-4 w-4" />} count={counters.MENTION} active={filter === 'MENTION'} onClick={() => setFilter('MENTION')} />
            <FilterRow label="DM" icon={<Send className="h-4 w-4" />} count={counters.DM} active={filter === 'DM'} onClick={() => setFilter('DM')} />
            <FilterRow label="Emails" icon={<Mail className="h-4 w-4" />} count={counters.EMAIL} active={filter === 'EMAIL'} onClick={() => setFilter('EMAIL')} />
            <FilterRow label="Commentaires" icon={<MessageCircle className="h-4 w-4" />} count={counters.COMMENT} active={filter === 'COMMENT'} onClick={() => setFilter('COMMENT')} />
          </nav>
          {counters.UNREAD > 0 ? (
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={markingAll}
              className="mt-2 w-full rounded-md border px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              {markingAll ? 'En cours…' : `Tout marquer lu (${counters.UNREAD})`}
            </button>
          ) : null}

          <div className="mt-4">
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Par marque</div>
            <div className="space-y-1 text-sm">
              <button
                type="button"
                onClick={() => setBrandFilter(null)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1.5',
                  brandFilter === null ? 'bg-slate-900 text-white' : 'hover:bg-slate-100',
                )}
              >
                <span>Toutes</span>
              </button>
              {brandOptions.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBrandFilter(b.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5',
                    brandFilter === b.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-100',
                  )}
                >
                  <span className="truncate">{b.name}</span>
                </button>
              ))}
              {brandOptions.length === 0 ? (
                <div className="px-2 py-1 text-xs text-slate-500">Aucune marque liée</div>
              ) : null}
            </div>
          </div>

          <div className="mt-4">
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Par sentiment</div>
            <nav className="space-y-1 text-sm">
              <FilterRow
                label="Positif"
                icon={<Heart className="h-4 w-4 text-emerald-500" />}
                count={counters.POS}
                active={filter === 'SENTIMENT_POSITIVE'}
                onClick={() => setFilter('SENTIMENT_POSITIVE')}
              />
              <FilterRow
                label="Négatif"
                icon={<AlertTriangle className="h-4 w-4 text-rose-500" />}
                count={counters.NEG}
                active={filter === 'SENTIMENT_NEGATIVE'}
                onClick={() => setFilter('SENTIMENT_NEGATIVE')}
              />
              <FilterRow
                label="Neutre"
                icon={<span className="inline-block h-2 w-2 rounded-full bg-slate-400" />}
                count={counters.NEU}
                active={filter === 'SENTIMENT_NEUTRAL'}
                onClick={() => setFilter('SENTIMENT_NEUTRAL')}
              />
            </nav>
          </div>

          <div className="mt-auto pt-4 text-[11px] text-slate-500">
            Raccourcis : <kbd className="rounded border bg-slate-50 px-1">j</kbd>/<kbd className="rounded border bg-slate-50 px-1">k</kbd> naviguer,{' '}
            <kbd className="rounded border bg-slate-50 px-1">r</kbd> répondre, <kbd className="rounded border bg-slate-50 px-1">e</kbd> archiver,{' '}
            <kbd className="rounded border bg-slate-50 px-1">m</kbd> marquer lu
          </div>
        </Card>
      </aside>

      {/* CENTER */}
      <section className="flex-1 min-w-0">
        <Card className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">{filtered.length} interaction{filtered.length > 1 ? 's' : ''}</h3>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={syncNow} disabled={syncing}>
              <RefreshCw className={cn('mr-1 h-3 w-3', syncing && 'animate-spin')} />
              {syncing ? 'Synchronisation…' : 'Synchroniser'}
            </Button>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="p-6 text-center text-sm text-slate-500">Aucune interaction</li>
            ) : (
              filtered.map((i) => {
                const isActive = selectedId === i.id;
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(i.id)}
                      className={cn(
                        'flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors',
                        isActive ? 'bg-brand-50' : 'hover:bg-slate-50',
                      )}
                    >
                      <Avatar name={i.fromName} url={i.avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn('truncate text-sm', i.isUnread ? 'font-semibold text-slate-900' : 'text-slate-700')}>
                            {i.fromName}
                          </span>
                          {i.fromHandle ? <span className="truncate text-xs text-slate-500">{i.fromHandle}</span> : null}
                          <Badge variant={platformBadgeVariant(i.platform)} className="ml-auto shrink-0 text-[10px]">{platformLabel(i.platform)}</Badge>
                        </div>
                        <p className={cn('mt-0.5 line-clamp-2 text-sm', i.isUnread ? 'text-slate-800' : 'text-slate-600')}>
                          {i.content}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <span className={cn('inline-block h-2 w-2 rounded-full', sentimentClass(i.sentiment))} />
                          {i.postTitle ? (
                            <Badge variant="secondary" className="text-[10px]">↪ {i.postTitle}</Badge>
                          ) : null}
                          {i.isUnread ? (
                            <Badge variant="info" className="text-[10px]">NEW</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">{i.status}</Badge>
                          )}
                          <span className="ml-auto">{relativeTime(i.receivedAt)}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </Card>
      </section>

      {/* RIGHT */}
      <section className="flex-1 min-w-0">
        <Card className="flex h-full flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
              Sélectionne une interaction
            </div>
          ) : (
            <>
              <div className="border-b p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={selected.fromName} url={selected.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{selected.fromName}</span>
                      {selected.fromHandle ? <span className="text-sm text-slate-500">{selected.fromHandle}</span> : null}
                      <Badge variant={platformBadgeVariant(selected.platform)} className="ml-auto text-[10px]">{platformLabel(selected.platform)}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className={cn('inline-block h-2 w-2 rounded-full', sentimentClass(selected.sentiment))} />
                      <span>{relativeTime(selected.receivedAt)}</span>
                      {selected.brandName ? <Badge variant="secondary" className="text-[10px]">{selected.brandName}</Badge> : null}
                      {selected.postTitle ? <Badge variant="secondary" className="text-[10px]">↪ {selected.postTitle}</Badge> : null}
                      {selected.isAutoReplied ? <Badge variant="success" className="text-[10px]">Auto-replied</Badge> : null}
                      {selected.assigneeName ? <Badge variant="info" className="text-[10px]">@{selected.assigneeName}</Badge> : null}
                    </div>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{selected.content}</p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Fil de discussion</div>
                {thread.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-xs text-slate-500">
                    Aucun message précédent dans ce fil.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {thread.map((m) => (
                      <li
                        key={m.id}
                        className={cn(
                          'rounded-md border p-3 text-sm',
                          m.isFromUs ? 'bg-brand-50 border-brand-100' : 'bg-slate-50',
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-medium text-slate-700">{m.fromName}</span>
                          <span>{relativeTime(m.receivedAt)}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-slate-800">{m.content}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="border-t p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => markRead(selected.id)}>
                    <Check className="mr-1 h-4 w-4" /> Marquer lu
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => archive(selected.id)}>
                    <Archive className="mr-1 h-4 w-4" /> Archiver
                  </Button>
                  <div className="relative">
                    <Button size="sm" variant="outline" onClick={() => setShowAssign((s) => !s)}>
                      <UserPlus className="mr-1 h-4 w-4" /> Assigner
                    </Button>
                    {showAssign ? (
                      <div className="absolute z-10 mt-1 w-56 rounded-md border bg-white p-1 shadow-lg">
                        {teamMembers.length === 0 ? (
                          <div className="px-2 py-1 text-xs text-slate-500">Aucun membre</div>
                        ) : (
                          teamMembers.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => assign(selected.id, m.userId, m.name)}
                              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100"
                            >
                              {m.name}
                              {m.email ? <span className="ml-1 text-xs text-slate-500">{m.email}</span> : null}
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    <span className="text-[11px] text-slate-500">Sentiment:</span>
                    <button
                      type="button"
                      title="Positif"
                      onClick={() => overrideSentiment(selected.id, 'POSITIVE')}
                      className={cn('h-5 w-5 rounded-full border', selected.sentiment === 'POSITIVE' ? 'ring-2 ring-emerald-500' : '', 'bg-emerald-500')}
                    />
                    <button
                      type="button"
                      title="Neutre"
                      onClick={() => overrideSentiment(selected.id, 'NEUTRAL')}
                      className={cn('h-5 w-5 rounded-full border', selected.sentiment === 'NEUTRAL' ? 'ring-2 ring-slate-500' : '', 'bg-slate-400')}
                    />
                    <button
                      type="button"
                      title="Négatif"
                      onClick={() => overrideSentiment(selected.id, 'NEGATIVE')}
                      className={cn('h-5 w-5 rounded-full border', selected.sentiment === 'NEGATIVE' ? 'ring-2 ring-rose-500' : '', 'bg-rose-500')}
                    />
                  </div>
                </div>

                <Textarea
                  ref={replyRef}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Écris ta réponse..."
                  className="min-h-[100px]"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={proposeReply} disabled={proposing}>
                    <Sparkles className="mr-1 h-4 w-4" />
                    {proposing ? 'Génération...' : 'Suggérer une réponse'}
                  </Button>
                  <Button size="sm" onClick={sendReply} disabled={sending || !reply.trim()} className="ml-auto">
                    <Send className="mr-1 h-4 w-4" />
                    {sending ? 'Envoi...' : 'Envoyer'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </section>
    </div>
  );
}

function FilterRow({
  label,
  icon,
  count,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors',
        active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
      )}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className={cn('rounded-full px-2 py-0.5 text-[11px]', active ? 'bg-white/20' : 'bg-slate-100 text-slate-600')}>{count}</span>
    </button>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="h-9 w-9 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
      {initial}
    </div>
  );
}
