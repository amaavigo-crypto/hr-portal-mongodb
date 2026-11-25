import { useCallback, useEffect, useRef, useState } from 'react';
import { homeService } from '../services/homeService';
import { leaveService } from '../services/leaveService';
import type { AttentionResult } from '../../shared/attention';

export interface UpdateRow { id: string; title: string; body: string; link?: string; read: boolean; createdAt: string }
export interface AttentionState {
  attention: AttentionResult | null;
  updates: UpdateRow[];
  unread: number;
  loading: boolean;
  /** What the bell shows: things waiting plus unread updates. */
  badge: number;
  refresh: () => Promise<void>;
  markRead: (ids: string[] | 'all') => Promise<void>;
}

const EVERY_MS = 5 * 60_000;

/** The bell's data. Loads when the person is signed in, then again every 5 minutes while the tab is visible and when it regains focus. */
export function useAttention(enabled: boolean): AttentionState {
  const [attention, setAttention] = useState<AttentionResult | null>(null);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const [a, u] = await Promise.allSettled([homeService.attention(), leaveService.notifications()]);
      if (a.status === 'fulfilled' && (a.value as any)?.groups) setAttention(a.value);
      if (u.status === 'fulfilled') { setUpdates(((u.value as any)?.items || []) as UpdateRow[]); setUnread(Number((u.value as any)?.unread || 0)); }
    } finally { busy.current = false; setLoading(false); }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setAttention(null); setUpdates([]); setUnread(0); return; }
    void refresh();
    const tick = () => { if (document.visibilityState === 'visible') void refresh(); };
    const id = window.setInterval(tick, EVERY_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [enabled, refresh]);

  const markRead = useCallback(async (ids: string[] | 'all') => {
    try { await leaveService.readNotifications(ids); } finally { await refresh(); }
  }, [refresh]);

  return { attention, updates, unread, loading, badge: (attention?.total || 0) + unread, refresh, markRead };
}
