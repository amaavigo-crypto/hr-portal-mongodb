/**
 * "Needs attention": everything waiting for one person, from every module, in one list. Pure code (no database, no network),
 * tested in tests/attention.test.ts. api/_lib/attentionApi.ts gathers each module's own answer as the signed-in person and
 * passes it through the builders below, so who-sees-what stays decided by each module.
 *
 * The list is live: an item is there while the work is waiting and gone when it is done. Nothing can be dismissed by hand.
 */
import { cleanText, daysBetween } from './leaveAgentTools.js';
import { gapsOf, GAP_LABEL, reviewQueue, type PersonRow } from './employeeAgentTools.js';
import { IDENTITY_TYPES } from './employeeIdentity.js';
import type { WidgetTarget } from './dashboard.js';

export type AttentionModule = 'leave' | 'documents' | 'people' | 'performance' | 'payroll';
export const MODULE_LABEL: Record<AttentionModule, string> = {
  leave: 'Leave & attendance', documents: 'Documents', people: 'People', performance: 'Performance', payroll: 'Payroll',
};
export const MAX_PER_MODULE = 10;

export interface AttentionItem {
  id: string; module: AttentionModule; title: string; detail?: string; waitingDays?: number; urgent?: boolean; target: WidgetTarget;
}
export interface AttentionGroup { module: AttentionModule; label: string; count: number; items: AttentionItem[]; more: number }
export interface AttentionResult { total: number; groups: AttentionGroup[]; partial: boolean }

const item = (module: AttentionModule, id: string, title: string, target: WidgetTarget, extra: Partial<AttentionItem> = {}): AttentionItem =>
  ({ id: `${module}:${id}`, module, title: cleanText(title, 160), target, ...extra });

// ------------------------------------------------------------------ leave and attendance (the approvals inbox)

export function leaveItems(inbox: any): AttentionItem[] {
  const to: WidgetTarget = { module: 'leave-management', section: 'approvals' };
  const leaves: any[] = Array.isArray(inbox?.leaves) ? inbox.leaves : [];
  const regs: any[] = Array.isArray(inbox?.regularizations) ? inbox.regularizations : [];
  return [
    ...leaves.map((l) => item('leave', `l:${l.id}`,
      l.stage === 'CANCEL' ? `Approve cancellation: ${l.name}'s ${l.typeName}` : `Approve ${l.name}'s ${l.typeName}`, to, {
        detail: `${l.from === l.to ? l.from : `${l.from} to ${l.to}`}${l.coveringFor ? `, covering for ${l.coveringFor}` : ''}`,
        waitingDays: Number(l.waitingDays ?? 0), urgent: !!l.escalated,
      })),
    ...regs.map((r) => item('leave', `r:${r.id}`, `Review ${r.name}'s attendance correction`, to, { detail: String(r.date || '') })),
  ];
}

// ------------------------------------------------------------------ documents

export function ackItems(acks: any): AttentionItem[] {
  const list: any[] = Array.isArray(acks?.active?.items) ? acks.active.items : [];
  const total = Number(acks?.active?.count ?? list.length);
  const to: WidgetTarget = { module: 'document-version-control', docTab: 'employee' };
  const out = list.map((a, i) => item('documents', `a:${a.documentId || i}:${a.versionNumber}`, `Acknowledge ${a.title}`, to, { detail: a.versionNumber ? `Version ${a.versionNumber}` : undefined }));
  // The route lists a few; the rest still count.
  for (let i = list.length; i < total; i++) out.push(item('documents', `a:more:${i}`, 'Another policy to acknowledge', to));
  return out;
}

export function reviewItems(queue: any): AttentionItem[] {
  const to: WidgetTarget = { module: 'document-version-control', docTab: 'reviewer' };
  const wait: any[] = Array.isArray(queue?.items) ? queue.items : [];
  const back: any[] = Array.isArray(queue?.sentBack) ? queue.sentBack : [];
  return [
    ...wait.map((v) => item('documents', `v:${v.documentCode}:${v.version}`, `Review ${v.document} v${v.version}`, to, { detail: v.createdBy ? `From ${v.createdBy}` : undefined, waitingDays: v.createdDaysAgo ?? undefined })),
    ...back.map((v) => item('documents', `b:${v.documentCode}:${v.version}`, `Revise ${v.document} v${v.version}`, { module: 'document-version-control', docTab: 'creator' }, { detail: 'Sent back for changes', waitingDays: v.createdDaysAgo ?? undefined })),
  ];
}

// ------------------------------------------------------------------ people: tasks, identity documents, profile

export function taskItems(j: any, today: string): AttentionItem[] {
  const to: WidgetTarget = { module: 'people', section: 'tasks' };
  return (Array.isArray(j?.tasks) ? j.tasks : []).filter((t: any) => t.status === 'OPEN').map((t: any) => {
    const late = !!t.dueDate && t.dueDate < today;
    return item('people', `t:${t.id}`, t.own ? String(t.title || 'Task') : `${t.title} (for ${t.forName})`, to, {
      detail: t.dueDate ? `${late ? 'Was due' : 'Due'} ${t.dueDate}` : undefined, urgent: late, waitingDays: late ? daysBetween(t.dueDate, today) : undefined,
    });
  });
}

const idLabel = (k: string) => IDENTITY_TYPES.find((t) => t.key === k)?.label || k;

/** `rows` is the People route's answer: all people for HR, only the caller's own row for everyone else. */
export function peopleItems(rows: PersonRow[], meUid: string, today: string): AttentionItem[] {
  const out: AttentionItem[] = [];
  const mine = rows.find((r) => r.uid === meUid);
  const to: WidgetTarget = { module: 'people', section: 'directory' };
  if (mine) {
    for (const [type, info] of Object.entries(mine.identity || {})) {
      if ((info as any)?.status === 'REJECTED') out.push(item('people', `rej:${type}`, `Submit your ${idLabel(type)} again`, to, { detail: (info as any).note ? `HR said: ${cleanText((info as any).note, 100)}` : undefined, urgent: true }));
    }
    const gaps = gapsOf(mine);
    if (gaps.length) out.push(item('people', 'gaps', 'Complete your profile', to, { detail: `Missing: ${gaps.map((g) => GAP_LABEL[g]).join(', ')}` }));
  }
  // Only HR's call returns other people, so anyone else's queue is simply empty.
  const others = rows.filter((r) => r.uid !== meUid);
  for (const q of reviewQueue(others, today, 200).items) {
    out.push(item('people', `rv:${q.uid}:${q.type}`, `Review ${q.name}'s ${q.document}`, to, { waitingDays: q.daysWaiting ?? undefined }));
  }
  return out;
}

// ------------------------------------------------------------------ performance and payroll

export function performanceItems(home: any): AttentionItem[] {
  return (Array.isArray(home?.todo) ? home.todo : []).map((t: any, i: number) => item('performance', `${t.go}:${t.id || i}`, String(t.text || ''), { module: 'performance' }));
}

const STEP_WORD: Record<string, string> = { HR: 'HR verification', FINANCE: 'Finance verification', SIGNATORY: 'Final authorisation' };

/** One state per month, as `payroll-approval-state` answers it. An item appears only when it is this person's turn. */
export function payrollItems(states: { month: string; state: any }[]): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const { month, state } of states) {
    if (!state?.enabled || state.status !== 'DRAFT' || !state.next) continue;
    const step = (state.steps || []).find((s: any) => s.step === state.next);
    if (!step || step.problem) continue; // someone else's turn, or this person may not approve this step
    out.push(item('payroll', `a:${month}:${state.next}`, `${STEP_WORD[state.next] || state.next}: ${month} payroll`, { module: 'payroll', section: 'run' }, { urgent: true }));
  }
  return out;
}

// ------------------------------------------------------------------ putting it together

const byUrgency = (a: AttentionItem, b: AttentionItem) =>
  Number(!!b.urgent) - Number(!!a.urgent) || (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || a.title.localeCompare(b.title);

export function assemble(items: AttentionItem[], partial = false): AttentionResult {
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  const by = new Map<AttentionModule, AttentionItem[]>();
  for (const i of unique) by.set(i.module, [...(by.get(i.module) || []), i]);
  const groups: AttentionGroup[] = [...by.entries()].map(([module, list]) => {
    const sorted = list.sort(byUrgency);
    return { module, label: MODULE_LABEL[module], count: sorted.length, items: sorted.slice(0, MAX_PER_MODULE), more: Math.max(0, sorted.length - MAX_PER_MODULE) };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { total: unique.length, groups, partial };
}
