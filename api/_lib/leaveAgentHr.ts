/**
 * Leave & Attendance agent, stage 3: the HR actions that change records (mark attendance, close an exception, adjust a
 * leave balance). Registry and checks: shared/leaveAgentTools.ts.
 *
 * HR and company admin only (leave.manage). That is decided three times: the model is only told about these tools when the
 * person has the permission, `mayUseTool` refuses a forced call, and the leave route the action finally runs through
 * (`needManage`) checks the permission again with the person's own login.
 *
 * Every tool here is a proposal: it validates against the real records and shows a confirm card. The change itself runs only
 * in `runHrConfirm`, from the person's own click, and checks the rules a second time because the record may have changed in
 * the meantime. Nobody can change their own attendance, balance or exceptions this way.
 */
import { give, makeProposal, proposed, route, istDay, str, type Run } from './agentKit.js';
import { audit, personByUid } from './leaveCore.js';
import { lockedMonths } from './leavePayroll.js';
import {
  LEAVE_AGENT_TOOLS, attendanceProblem, balanceProblem, cleanText, cleanTime, cleanUid, dayWord, mayUseTool, matchLeaveType, type ProposalAction,
} from '../../shared/leaveAgentTools.js';

const HR_TOOLS = new Set(['propose_mark_attendance', 'propose_resolve_exception', 'propose_adjust_balance']);
export const HR_ACTIONS = new Set<ProposalAction>(['attendance_mark', 'exception_resolve', 'balance_adjust']);

const SELF = 'Nobody can change their own record this way. Ask another HR person to do it.';
const num = (n: number) => String(Math.round(n * 100) / 100);
const words = (s: string) => s.replace(/^FLAG_/, '').replace(/_/g, ' ').toLowerCase();
const dayLabel = (d: any) => {
  if (!d) return 'nothing recorded';
  const status = String(d.status || '').replace(/_/g, ' ').toLowerCase();
  return d.checkIn || d.checkOut ? `${status} (in ${d.checkIn || '-'}, out ${d.checkOut || '-'})` : status || 'nothing recorded';
};

async function monthLocked(r: Run, date: string): Promise<boolean | null> {
  try {
    return (await lockedMonths(r.cid)).has(date.slice(0, 7));
  } catch {
    return null;
  }
}

async function proposeMarkAttendance(r: Run, name: string, args: any): Promise<string> {
  const uid = cleanUid(args?.uid);
  const date = str(args?.date, 10);
  const checkIn = cleanTime(args?.checkIn);
  const checkOut = cleanTime(args?.checkOut);
  const reason = cleanText(args?.reason, 150);
  if (!uid) return give(r, name, null, { error: 'Use find_employee first to get the uid.' });
  if (uid === r.ctx.uid) return give(r, name, null, { error: SELF });
  if (!reason) return give(r, name, null, { error: 'A reason is needed. Ask the person for it, then try again.' });
  const problem = attendanceProblem({ date, checkIn, checkOut }, istDay());
  if (problem) return give(r, name, null, { error: problem });
  const people = await route(r, 'leave', 'GET', 'people');
  if (people.error) return give(r, name, null, people);
  const person = (Array.isArray(people.items) ? people.items : []).find((p: any) => p.uid === uid);
  if (!person) return give(r, name, null, { error: 'No employee with that uid. Use find_employee.' });
  const locked = await monthLocked(r, date);
  if (locked === null) return give(r, name, null, { error: 'Could not check whether payroll for that month is locked. Try again.' });
  if (locked) return give(r, name, null, { error: `Payroll for ${date.slice(0, 7)} is locked, so its attendance is not changed here. Use the Attendance screen and the payroll correction flow.` });
  const cur = await route(r, 'leave', 'GET', 'attendance-report', undefined, { from: date, to: date, uid });
  if (cur.error) return give(r, name, null, cur);
  const day = cur.people?.[0]?.days?.[0];
  const before = dayLabel(day);
  const label = cleanText(person.name, 80);
  const card = await makeProposal(r, 'attendance_mark', { uid, date, checkIn, checkOut, reason, employee: label, before }, {
    title: `Record attendance: ${label}, ${date}`,
    lines: [
      `Employee: ${label}${person.empId ? ` (${cleanText(person.empId, 30)})` : ''}`,
      `Recorded now: ${before}`,
      `Will be: in ${checkIn}, out ${checkOut}`,
      `Reason: ${reason}`,
      'This replaces what is recorded for that day and is kept in the audit trail.',
    ],
    confirmLabel: 'Confirm attendance',
  });
  return proposed(r, name, card);
}

async function proposeResolveException(r: Run, name: string, args: any): Promise<string> {
  const id = str(args?.exceptionId, 220);
  const resolution = cleanText(args?.resolution, 300);
  if (!id) return give(r, name, null, { error: 'Give the exceptionId from get_leave_exceptions.' });
  if (!resolution) return give(r, name, null, { error: 'Say how it was resolved. Ask the person, then try again.' });
  const j = await route(r, 'leave', 'GET', 'exceptions');
  if (j.error) return give(r, name, null, j);
  const e = (Array.isArray(j.items) ? j.items : []).find((x: any) => x.id === id && x.status === 'OPEN');
  if (!e) return give(r, name, null, { error: 'That is not an open exception. Check get_leave_exceptions.' });
  if (e.uid === r.ctx.uid || e.flag?.uid === r.ctx.uid) return give(r, name, null, { error: SELF });
  if (!e.canAct) return give(r, name, null, { error: 'This person cannot close that kind of exception (payroll flags belong to payroll managers).' });
  const who = cleanText(e.employee, 80);
  const card = await makeProposal(r, 'exception_resolve', { id, resolution, category: String(e.category || ''), employee: who }, {
    title: `Close exception: ${words(String(e.category || 'exception'))}${who ? `, ${who}` : ''}`,
    lines: [...(who ? [`Employee: ${who}`] : []), `Raised: ${String(e.createdAt || '').slice(0, 10) || 'unknown'}`, `What it says: ${cleanText(e.message, 200)}`, `Resolution: ${resolution}`, 'Closing it is kept in the audit trail.'],
    confirmLabel: 'Confirm close',
  });
  return proposed(r, name, card);
}

async function balanceOfPerson(r: Run, uid: string, typeQuery: unknown) {
  const j = await route(r, 'leave', 'GET', 'report-balances');
  if (j.error) return { error: j };
  const row = (Array.isArray(j.rows) ? j.rows : []).find((x: any) => x.uid === uid);
  return { types: Array.isArray(j.types) ? j.types : [], row, type: matchLeaveType<any>(Array.isArray(j.types) ? j.types : [], typeQuery) };
}

async function proposeAdjustBalance(r: Run, name: string, args: any): Promise<string> {
  const uid = cleanUid(args?.uid);
  const days = Number(args?.days);
  const reason = cleanText(args?.reason, 250);
  if (!uid) return give(r, name, null, { error: 'Use find_employee first to get the uid.' });
  if (uid === r.ctx.uid) return give(r, name, null, { error: SELF });
  if (!reason) return give(r, name, null, { error: 'A reason is needed. Ask the person for it, then try again.' });
  const b = await balanceOfPerson(r, uid, args?.leaveType);
  if ('error' in b) return give(r, name, null, b.error);
  if (!b.row) return give(r, name, null, { error: 'No active employee with that uid. Use find_employee.' });
  if (!b.type) return give(r, name, null, { error: 'Ask which leave type they mean.', leaveTypes: b.types.map((t: any) => t.name) });
  const current = b.row.balances?.[b.type.id];
  if (current === null || current === undefined) return give(r, name, null, { error: `${b.type.name} is not part of ${cleanText(b.row.name, 60)}'s leave policy, so it has no balance to change.` });
  const problem = balanceProblem(days, current);
  if (problem) return give(r, name, null, { error: problem });
  const after = Math.round((current + days) * 100) / 100;
  const label = cleanText(b.row.name, 80);
  const card = await makeProposal(r, 'balance_adjust', { uid, typeId: b.type.id, typeName: b.type.name, delta: days, note: reason, employee: label }, {
    title: `${days > 0 ? 'Add' : 'Deduct'} ${dayWord(Math.abs(days))}: ${b.type.name}, ${label}`,
    lines: [`Employee: ${label}${b.row.empId ? ` (${cleanText(b.row.empId, 30)})` : ''}`, `Balance now: ${num(current)} days`, `Balance after: ${num(after)} days`, `Reason: ${reason}`, 'This is posted to their leave ledger and kept in the audit trail.'],
    confirmLabel: days > 0 ? 'Confirm add' : 'Confirm deduct', destructive: days < 0,
  });
  return proposed(r, name, card);
}

/** Returns the tool result for a stage 3 tool, or null when `name` is not one of them. */
export async function runLeaveHrTool(r: Run, name: string, args: any): Promise<string | null> {
  if (!HR_TOOLS.has(name)) return null;
  const def = LEAVE_AGENT_TOOLS.find((t) => t.name === name)!;
  if (!mayUseTool(r.ctx, def)) return give(r, name, null, { error: 'Not available for your role.' });
  switch (name) {
    case 'propose_mark_attendance': return await proposeMarkAttendance(r, name, args);
    case 'propose_resolve_exception': return await proposeResolveException(r, name, args);
    case 'propose_adjust_balance': return await proposeAdjustBalance(r, name, args);
    default: return null;
  }
}

/**
 * Runs a confirmed stage 3 proposal as the person who confirmed it. The rules are checked again, because the card may be
 * 30 minutes old: no own record, month still unlocked, balance still enough. The leave route then checks permission.
 */
export async function runHrConfirm(r: Run, action: ProposalAction, a: Record<string, any>): Promise<{ j: any; success: string }> {
  const fail = (error: string) => ({ j: { error }, success: '' });
  if (a.uid && a.uid === r.ctx.uid) return fail(SELF);
  if (action === 'attendance_mark') {
    const problem = attendanceProblem({ date: String(a.date || ''), checkIn: String(a.checkIn || ''), checkOut: String(a.checkOut || '') }, istDay());
    if (problem) return fail(problem);
    const locked = await monthLocked(r, String(a.date));
    if (locked !== false) return fail(locked ? `Payroll for ${String(a.date).slice(0, 7)} has been locked since this was prepared, so it was not changed.` : 'Could not check whether payroll is locked. Nothing was changed.');
    const j = await route(r, 'leave', 'POST', 'mark-attendance', { uid: a.uid, date: a.date, checkIn: a.checkIn, checkOut: a.checkOut, note: `Via Ask HR: ${cleanText(a.reason, 150)}` });
    if (!j.error) {
      const me = await personByUid(r.cid, r.ctx.uid).catch(() => null);
      await audit(r.cid, 'leave-attendance', String(a.uid), 'ATTENDANCE_MARKED_ASK_HR', { name: me?.name || r.ctx.email || r.ctx.uid, uid: r.ctx.uid },
        { date: a.date, before: a.before || '' }, { checkIn: a.checkIn, checkOut: a.checkOut, reason: a.reason }).catch(() => undefined);
    }
    return { j, success: `Recorded: ${str(a.employee, 80) || 'attendance'} on ${a.date}, in ${a.checkIn}, out ${a.checkOut}.` };
  }
  if (action === 'exception_resolve') {
    const j = await route(r, 'leave', 'POST', 'exception-resolve', { id: a.id, resolution: a.resolution });
    return { j, success: 'Closed. The resolution is saved.' };
  }
  if (action === 'balance_adjust') {
    if (Number(a.delta) < 0) {
      const b = await balanceOfPerson(r, String(a.uid), a.typeId);
      if ('error' in b) return { j: b.error, success: '' };
      const now = b.row?.balances?.[String(a.typeId)];
      const problem = balanceProblem(Number(a.delta), typeof now === 'number' ? now : null);
      if (problem) return fail(`${problem} Nothing was changed.`);
    }
    const j = await route(r, 'leave', 'POST', 'adjust', { uid: a.uid, typeId: a.typeId, delta: a.delta, note: `Via Ask HR: ${cleanText(a.note, 250)}`, kind: 'ADJUST' });
    return { j, success: `${Number(a.delta) > 0 ? 'Added' : 'Deducted'} ${dayWord(Math.abs(Number(a.delta)))} of ${str(a.typeName, 60) || 'leave'} for ${str(a.employee, 80) || 'the employee'}.` };
  }
  return fail('Unknown action.');
}
