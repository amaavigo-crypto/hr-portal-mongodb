import React, { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, ChevronRight, Clock, Loader2, RefreshCw, X } from 'lucide-react';
import type { WidgetTarget } from '../../shared/dashboard';
import type { AttentionState } from './useAttention';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  state: AttentionState;
  onOpen: (target: WidgetTarget) => void;
}

const waitText = (d?: number) => (d === undefined || d <= 0 ? '' : d === 1 ? 'waiting 1 day' : `waiting ${d} days`);

/** The bell's panel: what needs this person's attention right now, and the short list of updates. */
export const NotificationCenter: React.FC<Props> = ({ isOpen, onClose, state, onOpen }) => {
  const [tab, setTab] = useState<'attention' | 'updates'>('attention');
  const { attention, updates, unread, loading, refresh, markRead } = state;

  useEffect(() => { if (isOpen) void refresh(); }, [isOpen, refresh]);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const go = (t: WidgetTarget) => { onClose(); onOpen(t); };
  const total = attention?.total ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Notifications">
      <button type="button" className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-label="Close notifications" />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between bg-slate-900 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10"><BellRing className="h-5 w-5" /></div>
            <div>
              <h2 className="text-base font-bold leading-tight">Notifications</h2>
              <p className="text-xs text-slate-300">{total ? `${total} ${total === 1 ? 'thing needs' : 'things need'} your attention` : 'Nothing is waiting for you'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void refresh()} className="rounded-lg p-2 hover:bg-white/10" aria-label="Refresh" title="Refresh">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="flex gap-1 border-b border-slate-200 px-4 pt-3 text-xs font-bold">
          {([['attention', `Needs attention${total ? ` (${total})` : ''}`], ['updates', `Updates${unread ? ` (${unread})` : ''}`]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-t-lg px-4 py-2 ${tab === k ? 'border-b-2 border-[#FA7014] text-[#FA7014]' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'attention' && (
            <div className="p-4">
              {!attention && loading && <p className="py-10 text-center text-sm text-slate-400">Checking…</p>}
              {attention && attention.total === 0 && (
                <div className="py-14 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                  <p className="mt-3 text-sm font-bold text-slate-700">You are all caught up</p>
                  <p className="mt-1 text-xs text-slate-400">Approvals, policies, tasks and reviews that need you will appear here.</p>
                </div>
              )}
              {attention?.partial && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Some areas could not be checked just now. Refresh to try again.</p>}
              {attention?.groups.map((g) => (
                <section key={g.module} className="mb-5">
                  <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {g.label}<span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{g.count}</span>
                  </h3>
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {g.items.map((i) => (
                      <li key={i.id}>
                        <button type="button" onClick={() => go(i.target)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${i.urgent ? 'bg-rose-500' : 'bg-[#FA7014]'}`} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-800">{i.title}</span>
                            {(i.detail || i.waitingDays) ? (
                              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                                {i.waitingDays ? <Clock className="h-3 w-3" /> : null}
                                {[i.detail, waitText(i.waitingDays)].filter(Boolean).join(' · ')}
                              </span>
                            ) : null}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                        </button>
                      </li>
                    ))}
                    {g.more > 0 && (
                      <li><button type="button" onClick={() => go(g.items[0].target)} className="w-full px-3 py-2 text-left text-xs font-bold text-[#FA7014] hover:bg-slate-50">and {g.more} more: open {g.label}</button></li>
                    )}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {tab === 'updates' && (
            <div className="p-4">
              {unread > 0 && (
                <div className="mb-3 text-right"><button type="button" onClick={() => void markRead('all')} className="text-xs font-bold text-slate-500 hover:text-slate-800">Mark all read</button></div>
              )}
              {updates.length === 0 && <p className="py-10 text-center text-sm text-slate-400">No updates yet.</p>}
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {updates.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 text-left hover:bg-slate-50"
                      onClick={() => { if (!n.read) void markRead([n.id]); if (n.link) go({ module: 'leave-management', section: n.link }); }}
                    >
                      <span className={`block text-sm ${n.read ? 'text-slate-500' : 'font-bold text-slate-800'}`}>{n.title}</span>
                      <span className="block text-xs text-slate-400">{n.body}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
