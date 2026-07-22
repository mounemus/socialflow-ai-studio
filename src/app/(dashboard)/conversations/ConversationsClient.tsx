'use client';
import { useState } from 'react';
import { Inbox, Ear } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUnreadCount } from '@/components/layout/useUnreadCount';
import { InboxClient, type Interaction, type TeamMemberLite } from '../inbox/InboxClient';
import {
  ListeningClient,
  type Mention,
  type ListeningAlert,
  type WatchLite,
} from '../listening/ListeningClient';

/**
 * Conversations (Refonte Phase C) — tout ce que le public dit, en un seul
 * endroit : la Boîte de réception (commentaires/messages sur TES posts) et
 * le Social Listening (mentions de la marque ailleurs sur le web).
 *
 * Les deux vues restent MONTÉES au changement d'onglet (masquage CSS) : le
 * fil de lecture, les filtres et les brouillons de réponse survivent — même
 * principe que l'Atelier créatif.
 */
export function ConversationsClient(props: {
  inbox: { initialInteractions: Interaction[]; teamMembers: TeamMemberLite[] };
  listening: { initialMentions: Mention[]; alerts: ListeningAlert[]; watches: WatchLite[] };
}) {
  const [tab, setTab] = useState<'inbox' | 'listening'>('inbox');
  const unread = useUnreadCount();

  const tabs = [
    { id: 'inbox' as const, label: 'Boîte de réception', icon: Inbox, badge: unread },
    { id: 'listening' as const, label: 'Social Listening', icon: Ear, badge: 0 },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Conversations</h1>
        <p className="text-sm text-muted-foreground">
          Tout ce que le public dit : sur tes publications (réception) et ailleurs sur le web
          (listening).
        </p>
      </div>

      <div className="flex gap-1 border-b" role="tablist" aria-label="Sources de conversations">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-muted-foreground hover:text-slate-900',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {t.badge > 0 ? (
                <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                  {t.badge > 99 ? '99+' : t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className={tab === 'inbox' ? undefined : 'hidden'}>
        <InboxClient
          initialInteractions={props.inbox.initialInteractions}
          teamMembers={props.inbox.teamMembers}
        />
      </div>
      <div className={tab === 'listening' ? undefined : 'hidden'}>
        <ListeningClient
          initialMentions={props.listening.initialMentions}
          initialAlerts={props.listening.alerts}
          watches={props.listening.watches}
        />
      </div>
    </div>
  );
}
