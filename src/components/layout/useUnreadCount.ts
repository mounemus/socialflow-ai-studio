'use client';
import { useEffect, useState } from 'react';

/**
 * Compteur de non-lus de la boîte de réception.
 *
 * Sidebar (desktop) et MobileNav (drawer) sont montés SIMULTANÉMENT dans le
 * layout — le `lg:hidden` ne masque qu'en CSS. Un `setInterval` par composant
 * produisait donc deux requêtes identiques par minute sur chaque page, chacune
 * coûtant auth() + requireTenant() + count().
 *
 * Un seul poller au niveau module alimente tous les abonnés, et il est
 * suspendu quand l'onglet est caché.
 */
let sharedCount = 0;
let timer: number | undefined;
let inFlight = false;
const subscribers = new Set<(n: number) => void>();

async function fetchUnread(): Promise<void> {
  if (inFlight || (typeof document !== 'undefined' && document.hidden)) return;
  inFlight = true;
  try {
    const res = await fetch('/api/inbox/unread-count', { cache: 'no-store' });
    if (!res.ok) return;
    // ok() wraps payloads in { data: ... } — tolerate both shapes.
    const payload = (await res.json()) as { count?: number; data?: { count?: number } };
    const count = payload.data?.count ?? payload.count;
    if (typeof count === 'number' && count !== sharedCount) {
      sharedCount = count;
      for (const notify of subscribers) notify(count);
    }
  } catch {
    // ignore — le prochain tick réessaie
  } finally {
    inFlight = false;
  }
}

function onVisibilityChange(): void {
  if (!document.hidden) void fetchUnread();
}

function startPolling(): void {
  if (timer !== undefined) return;
  void fetchUnread();
  timer = window.setInterval(() => void fetchUnread(), 60_000);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function stopPolling(): void {
  if (timer === undefined) return;
  window.clearInterval(timer);
  timer = undefined;
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

export function useUnreadCount(): number {
  const [unreadCount, setUnreadCount] = useState<number>(sharedCount);
  useEffect(() => {
    subscribers.add(setUnreadCount);
    startPolling();
    setUnreadCount(sharedCount);
    return () => {
      subscribers.delete(setUnreadCount);
      if (subscribers.size === 0) stopPolling();
    };
  }, []);
  return unreadCount;
}
