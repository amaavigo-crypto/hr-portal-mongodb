import React, { useEffect, useRef, useState } from 'react';
import { Bot, X, Send, RotateCcw, Search } from 'lucide-react';
import { hrAgentService } from '../../services/hrAgentService';

interface Msg { role: 'user' | 'assistant'; content: string; tools?: string[]; unsure?: boolean }

const KEY = (uid: string) => `hr-agent-chat:${uid}`;
const SUGGESTIONS = [
  'What leave requests are waiting for a decision?',
  'Who was late or absent this week?',
  'Show the hiring pipeline by status',
  'Which new joiners have overdue onboarding tasks?',
  'Who still has to acknowledge a policy?',
  'What performance items need HR attention?',
];
const TOOL_LABEL: Record<string, string> = {
  find_employee: 'People', get_pending_leave_requests: 'Leave requests', get_pending_regularizations: 'Attendance corrections', get_leave_exceptions: 'Exceptions',
  get_attendance_summary: 'Attendance', get_leave_ledger: 'Leave ledger', get_hiring_pipeline: 'Hiring pipeline', get_candidate_detail: 'Candidate',
  get_onboarding_status: 'Onboarding', get_exits: 'Exits', get_pending_acknowledgments: 'Policy acknowledgments', get_performance_todo: 'Performance',
};

/** HR Agent side panel. Only HR roles are shown it (the server checks again on every call). Phase 1: look-ups only, nothing here changes a record. */
export const HrAgentPanel: React.FC<{ userId: string }> = ({ userId }) => {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { const v = JSON.parse(sessionStorage.getItem(KEY(userId)) || '[]'); return Array.isArray(v) ? v.slice(-20) : []; } catch { return []; }
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;

  useEffect(() => { let live = true; hrAgentService.status().then((r) => { if (live) setAvailable(!!r.available); }).catch(() => undefined); return () => { live = false; }; }, [userId]);
  useEffect(() => { try { sessionStorage.setItem(KEY(userId), JSON.stringify(msgs.slice(-20))); } catch { /* storage full or blocked; session only, so HR data does not stay on a shared computer */ } }, [msgs, userId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const history = msgsRef.current.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setText('');
    setBusy(true);
    try {
      const r = await hrAgentService.chat(question, history);
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, tools: r.tools || [], unsure: r.unsure }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: e?.message || 'Something went wrong. Please try again.', unsure: true }]);
    } finally { setBusy(false); }
  };

  if (!available) return null;

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="Open HR Agent" className="fixed bottom-20 right-5 z-40 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-lg hover:bg-slate-800 cursor-pointer">
          <Bot className="h-4 w-4" /> HR Agent
        </button>
      )}
      {open && (
        <aside role="dialog" aria-label="HR Agent" className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-200 bg-white shadow-2xl sm:w-[440px]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-slate-900">HR Agent</p>
              <p className="text-[11px] text-slate-500">Looks things up across Leave, Hiring, Onboarding and Policy. It cannot change anything yet.</p>
            </div>
            <div className="flex items-center gap-1">
              {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} title="New chat" aria-label="New chat" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 cursor-pointer"><RotateCcw className="h-4 w-4" /></button>}
              <button type="button" onClick={() => setOpen(false)} title="Close" aria-label="Close" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
            {msgs.length === 0 && (
              <div>
                <p className="text-sm text-slate-700">Ask what needs attention. I only show what your own permissions already allow.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 hover:border-slate-400 cursor-pointer">{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-900 px-3 py-2 text-sm text-white">{m.content}</p></div>
            ) : (
              <div key={i} className="max-w-[94%]">
                <p className={`whitespace-pre-wrap rounded-2xl rounded-bl-md border bg-white px-3 py-2 text-sm text-slate-800 ${m.unsure ? 'border-orange-200' : 'border-slate-200'}`}>{m.content}</p>
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {Array.from(new Set(m.tools)).map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"><Search className="h-3 w-3" />{TOOL_LABEL[t] || t}</span>)}
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="text-xs text-slate-500">Looking that up...</p>}
            <div ref={end} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="border-t border-slate-200 bg-white p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef} value={text} rows={1} maxLength={600} placeholder="Ask about leave, hiring, onboarding, policies..."
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
                className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white disabled:opacity-40 cursor-pointer"><Send className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">The HR Agent can make mistakes. Check important details on the screen before acting.</p>
          </form>
        </aside>
      )}
    </>
  );
};
