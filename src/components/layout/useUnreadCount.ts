'use client';
import { useEffect, useState } from 'react';

/**
 * Polls the inbox unread-count endpoint and returns the current count.
 * Shared by Sidebar (desktop) and MobileNav (drawer).
 */
export function useUnreadCount(): number {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    const fetchUnread = async () => {
      try {
        const res = await fetch('/api/inbox/unread-count', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (!cancelled && typeof data.count === 'number') setUnreadCount(data.count);
      } catch {
        // ignore
      }
    };
    void fetchUnread();
    const id = window.setInterval(fetchUnread, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  return unreadCount;
}
