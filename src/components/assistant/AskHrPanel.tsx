import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, ThumbsUp, ThumbsDown, RotateCcw, Mail, FileText, Database, Check, Loader2 } from 'lucide-react';
import { assistantService, type AssistantSource, type ProposalCard } from '../../services/assistantService';

/** A prepared action shown as a card. `state` tracks the person's click; the server has the final say. */
type CardState = ProposalCard & { state?: 'working' | 'DONE' | 'FAILED' | 'EXPIRED' | 'DISMISSED'; message?: string };
interface Msg { role: 'user' | 'assistant'; content: string; id?: string; sources?: AssistantSource[]; unsure?: boolean; rated?: boolean | null; sent?: string; question?: string; proposals?: CardState[] }

/** Other parts of the app (the Ctrl+K search) open the panel with a question by firing this event. */
export const ASK_HR_EVENT = 'ask-hr:open';
export const openAskHr = (question?: string) => window.dispatchEvent(new CustomEvent(ASK_HR_EVENT, { detail: { question } }));

const EMPLOYEE_SUGGESTIONS = ['How many casual leaves do I have?', 'What is the notice period?', 'What are the upcoming holidays?', 'What is the leave carry forward rule?'];
const MANAGER_SUGGESTIONS = ['What is waiting for my approval?', 'Who in my team is on leave next week?', 'How was my team\'s attendance this week?'];
const HR_SUGGESTIONS = ['What leave and attendance approvals are pending, and which are overdue?', 'Who is on leave in the next 7 days?', 'Who had the most late or absent days this month?', 'Show open leave exceptions'];

/** Which starter questions to show: HR gets company-wide ones, everyone else gets their own plus approvals for a manager. */
export const suggestionsFor = (perms?: string[] | null, isAdmin?: boolean): string[] => {
  if (isAdmin || (perms || []).includes('leave.manage') || (perms || []).includes('leave.report')) return [...HR_SUGGESTIONS, EMPLOYEE_SUGGESTIONS[0]];
  return [...EMPLOYEE_SUGGESTIONS.slice(0, 2), ...MANAGER_SUGGESTIONS.slice(0, 1), EMPLOYEE_SUGGESTIONS[2]];
};
const KEY = (uid: string) => `ask-hr-chat:${uid}`;

export const AskHrPanel: React.FC<{ userId: string; perms?: string[] | null; isAdmin?: boolean }> = ({ userId, perms, isAdmin }) => {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(KEY(userId)) || '[]');
      // A card that was mid-click when the page closed goes back to a plain card; the server decides if it is still valid.
      return Array.isArray(v) ? v.slice(-20).map((m: Msg) => (m.proposals ? { ...m, proposals: m.proposals.map((c) => (c.state === 'working' ? { ...c, state: undefined } : c)) } : m)) : []; } catch { return []; }
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;

  useEffect(() => { try { localStorage.setItem(KEY(userId), JSON.stringify(msgs.slice(-20))); } catch { /* storage full or blocked */ } }, [msgs, userId]);
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
      const r = await assistantService.ask(question, history);
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, id: r.id, sources: r.sources || [], unsure: r.unsure, question, proposals: r.proposals || [] }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: e?.message || 'Something went wrong. Please try again.', unsure: true, question }]);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const h = (e: Event) => {
      const q = String((e as CustomEvent).detail?.question || '').trim();
      setOpen(true);
      if (q) void send(q);
    };
    window.addEventListener(ASK_HR_EVENT, h);
    return () => window.removeEventListener(ASK_HR_EVENT, h);
  });

  const setCard = (i: number, cardId: string, patch: Partial<CardState>) =>
    setMsgs((all) => all.map((x, j) => (j === i ? { ...x, proposals: (x.proposals || []).map((c) => (c.id === cardId ? { ...c, ...patch } : c)) } : x)));
  const confirmCard = async (i: number, cardId: string) => {
    setCard(i, cardId, { state: 'working' });
    try {
      const r = await assistantService.confirm(cardId);
      setCard(i, cardId, { state: (r.status === 'DONE' ? 'DONE' : r.status === 'EXPIRED' ? 'EXPIRED' : r.status === 'DISMISSED' ? 'DISMISSED' : 'FAILED'), message: r.message });
    } catch (e: any) {
      setCard(i, cardId, { state: 'FAILED', message: e?.message || 'Could not complete this. Please try again.' });
    }
  };
  const dismissCard = (i: number, cardId: string) => {
    setCard(i, cardId, { state: 'DISMISSED', message: 'Dismissed. Nothing was changed.' });
    void assistantService.dismiss(cardId).catch(() => undefined);
  };

  const rate = (i: number, helpful: boolean) => {
    const m = msgs[i];
    if (!m?.id) return;
    setMsgs((all) => all.map((x, j) => (j === i ? { ...x, rated: helpful } : x)));
    void assistantService.feedback(m.id, helpful).catch(() => undefined);
  };
  const askHr = async (i: number) => {
    const m = msgs[i];
    if (!m?.question) return;
    setMsgs((all) => all.map((x, j) => (j === i ? { ...x, sent: 'Sending to HR...' } : x)));
    try {
      const r = await assistantService.askHr(m.question, m.id);
      setMsgs((all) => all.map((x, j) => (j === i ? { ...x, sent: r.message } : x)));
    } catch (e: any) {
      setMsgs((all) => all.map((x, j) => (j === i ? { ...x, sent: e?.message || 'Could not send. Please try again.' } : x)));
    }
  };

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="Open Ask HR" className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-[#FA7014] px-4 py-3 text-sm font-bold text-white shadow-lg hover:bg-[#e5650f] cursor-pointer">
          <MessageCircle className="h-4 w-4" /> Ask HR
        </button>
      )}
      {open && (
        <aside role="dialog" aria-label="Ask HR" className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-200 bg-white shadow-2xl sm:w-[400px]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-slate-900">Ask HR</p>
              <p className="text-[11px] text-slate-500">Leave, attendance and policy answers from your own access</p>
            </div>
            <div className="flex items-center gap-1">
              {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} title="New chat" aria-label="New chat" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 cursor-pointer"><RotateCcw className="h-4 w-4" /></button>}
              <button type="button" onClick={() => setOpen(false)} title="Close" aria-label="Close" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
            {msgs.length === 0 && (
              <div>
                <p className="text-sm text-slate-700">Hi, ask me about leave, attendance, holidays, approvals, your team or company policies. I only show what your role can see. I can also prepare approvals and leave applications for you to confirm.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestionsFor(perms, isAdmin).map((s) => <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:border-orange-300 hover:text-[#FA7014] cursor-pointer">{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#FA7014] px-3 py-2 text-sm text-white">{m.content}</p></div>
            ) : (
              <div key={i} className="max-w-[92%]">
                <p className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">{m.content}</p>
                {(m.proposals || []).map((c) => (
                  <div key={c.id} className={`mt-2 rounded-xl border bg-white p-3 text-sm ${c.state === 'DONE' ? 'border-emerald-300' : c.state === 'FAILED' ? 'border-red-300' : 'border-orange-300'}`}>
                    <p className="font-bold text-slate-900">{c.title}</p>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">{c.lines.map((l, k) => <li key={k}>{l}</li>)}</ul>
                    {!c.state || c.state === 'working' ? (
                      <div className="mt-2.5 flex items-center gap-2">
                        <button type="button" disabled={c.state === 'working'} onClick={() => void confirmCard(i, c.id)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60 cursor-pointer ${c.destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-[#FA7014] hover:bg-[#e5650f]'}`}>
                          {c.state === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{c.confirmLabel}
                        </button>
                        <button type="button" disabled={c.state === 'working'} onClick={() => dismissCard(i, c.id)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-60 cursor-pointer">Dismiss</button>
                      </div>
                    ) : (
                      <p className={`mt-2 text-xs font-semibold ${c.state === 'DONE' ? 'text-emerald-700' : c.state === 'FAILED' ? 'text-red-700' : 'text-slate-500'}`}>{c.message || (c.state === 'DONE' ? 'Done.' : '')}</p>
                    )}
                  </div>
                ))}
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.sources.map((s, k) => (
                      <span key={k} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${s.kind === 'data' ? 'bg-emerald-50 text-emerald-700' : 'border border-slate-300 text-slate-600'}`}>
                        {s.kind === 'data' ? <Database className="h-3 w-3" /> : <FileText className="h-3 w-3" />}{s.label}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  {m.id && (
                    <>
                      <button type="button" onClick={() => rate(i, true)} aria-label="Helpful" className={`rounded p-1 hover:bg-slate-200 cursor-pointer ${m.rated === true ? 'text-emerald-600' : ''}`}><ThumbsUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => rate(i, false)} aria-label="Not helpful" className={`rounded p-1 hover:bg-slate-200 cursor-pointer ${m.rated === false ? 'text-red-600' : ''}`}><ThumbsDown className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                  {m.question && !m.sent && <button type="button" onClick={() => void askHr(i)} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 cursor-pointer ${m.unsure || m.rated === false ? 'border-orange-300 text-[#FA7014]' : 'border-slate-200 hover:border-orange-300'}`}><Mail className="h-3 w-3" /> Ask HR instead</button>}
                  {m.sent && <span>{m.sent}</span>}
                </div>
              </div>
            ))}
            {busy && <p className="text-xs text-slate-500">Looking that up...</p>}
            <div ref={end} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="border-t border-slate-200 bg-white p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef} value={text} rows={1} maxLength={500} placeholder="Type your question..."
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
                className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#FA7014] focus:outline-none focus:ring-2 focus:ring-[#FA7014]/20"
              />
              <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FA7014] text-white disabled:opacity-40 cursor-pointer"><Send className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">Ask HR can make mistakes. For anything important, confirm with HR.</p>
          </form>
        </aside>
      )}
    </>
  );
};
