/**
 * People (employee lifecycle) tool pack for the Ask HR agent. Registry and counting: shared/peopleAgentTools.ts.
 *
 * Every tool calls the same People route the screens use (`/api/leave/lifecycle-*`), with the signed-in person's own
 * login, so company and permission checks are the ones that already apply. Read tools return counts worked out in code.
 * Propose tools validate against the real record, save a proposal and show a confirm card; the action itself runs only
 * in assistantApi `confirm`, from the person's own click. Resigning or withdrawing a resignation is not offered here.
 */
import { give, makeProposal, proposed, route, istDay, str, type Run } from './agentKit.js';
import { cleanText, cleanUid, dateSpan, isIsoDate } from '../../shared/leaveAgentTools.js';
import {
  PEOPLE_AGENT_TOOLS, canManagePeople, exitIsOpen, exitRow, mayUsePeopleTool, summarizeClearance, summarizeExits, summarizeOnboarding, summarizeTasks,
} from '../../shared/peopleAgentTools.js';

const money = (n: number) => String(Math.round(n * 100) / 100);
const STATUS_WORD: Record<string, string> = { CLEARED: 'Cleared', DUES: 'Dues owed', WAIVED: 'Waived', PENDING: 'Pending' };

async function proposeTaskDone(r: Run, name: string, args: any): Promise<string> {
  const id = str(args?.taskId, 200);
  if (!id) return give(r, name, null, { error: 'Give the taskId from get_my_onboarding_tasks.' });
  const j = await route(r, 'lifecycle', 'GET', 'onboarding-my');
  if (j.error) return give(r, name, null, j);
  const t = (Array.isArray(j.tasks) ? j.tasks : []).find((x: any) => x.id === id);
  if (!t) return give(r, name, null, { error: 'That task is not in this person\'s task list. Check get_my_onboarding_tasks.' });
  if (t.status !== 'OPEN') return give(r, name, null, { error: `That task is already ${String(t.status).toLowerCase()}.` });
  const note = cleanText(args?.note, 200);
  const card = await makeProposal(r, 'task_done', { taskId: id, note, title: cleanText(t.title, 120) }, {
    title: `Mark task done: ${cleanText(t.title, 100)}`,
    lines: [`For: ${t.own ? 'you' : cleanText(t.forName, 80)}`, ...(t.dueDate ? [`Due: ${t.dueDate}`] : []), ...(note ? [`Note: ${note}`] : [])],
    confirmLabel: 'Confirm done',
  });
  return proposed(r, name, card);
}

async function proposeExitDecision(r: Run, name: string, args: any): Promise<string> {
  const uid = cleanUid(args?.uid);
  const decision = String(args?.decision || '').toUpperCase();
  const note = cleanText(args?.note, 300);
  if (!uid || (decision !== 'APPROVE' && decision !== 'REJECT')) return give(r, name, null, { error: 'Give the employee uid from get_exits and a decision of APPROVE or REJECT.' });
  if (uid === r.ctx.uid) return give(r, name, null, { error: 'Nobody can decide on their own resignation.' });
  if (decision === 'REJECT' && !note) return give(r, name, null, { error: 'A reason is needed to reject. Ask the person for it, then try again.' });
  const j = await route(r, 'lifecycle', 'GET', 'exits');
  if (j.error) return give(r, name, null, j);
  const e = (Array.isArray(j.exits) ? j.exits : []).find((x: any) => x.employee?.uid === uid && ['SUBMITTED', 'MANAGER_APPROVED'].includes(x.status));
  if (!e) return give(r, name, null, { error: 'There is no resignation from that person waiting for a decision that this person can see.' });
  const hr = canManagePeople(r.ctx);
  if (e.status === 'MANAGER_APPROVED' && !hr) return give(r, name, null, { error: 'This resignation is waiting for HR, not for this person.' });
  const approve = decision === 'APPROVE';
  const lastDayArg = str(args?.lastWorkingDay, 10);
  if (lastDayArg && !hr) return give(r, name, null, { error: 'Only HR can change the last working day.' });
  if (lastDayArg && (!isIsoDate(lastDayArg) || lastDayArg < e.resignationDate)) return give(r, name, null, { error: 'The last working day is not valid.' });
  const lastDay = hr && approve && lastDayArg ? lastDayArg : '';
  const toHr = approve && e.status === 'SUBMITTED' && !hr;
  const card = await makeProposal(r, 'exit_decision', { uid, decision, note, lastWorkingDay: lastDay, employee: cleanText(e.employee?.name, 80) }, {
    title: `${approve ? 'Approve' : 'Reject'} resignation: ${cleanText(e.employee?.name, 80)}`,
    lines: [
      `Employee: ${cleanText(e.employee?.name, 80)}${e.employee?.department ? ` (${cleanText(e.employee.department, 60)})` : ''}`,
      `Resigned on: ${e.resignationDate}`,
      `Last working day ${lastDay ? 'set to' : 'requested'}: ${lastDay || e.requestedLastDay}`,
      ...(note ? [`Comment: ${note}`] : []),
      approve ? (toHr ? 'Your approval sends it to HR for the final decision.' : 'Accepting starts the notice period and the no-dues clearance.') : 'Rejecting closes this resignation.',
    ],
    confirmLabel: approve ? 'Confirm approve' : 'Confirm reject', destructive: !approve,
  });
  return proposed(r, name, card);
}

async function proposeExitClearance(r: Run, name: string, args: any): Promise<string> {
  const uid = cleanUid(args?.uid);
  const deptId = cleanUid(args?.deptId);
  const status = String(args?.status || '').toUpperCase();
  if (!uid || !deptId || !['CLEARED', 'DUES', 'WAIVED'].includes(status)) return give(r, name, null, { error: 'Give the uid and deptId from get_exit_details and a status of CLEARED, DUES or WAIVED.' });
  const hr = canManagePeople(r.ctx);
  if (uid === r.ctx.uid && !hr) return give(r, name, null, { error: 'Nobody can clear their own dues.' });
  if (status === 'WAIVED' && !hr) return give(r, name, null, { error: 'Only HR can waive a clearance.' });
  const j = await route(r, 'lifecycle', 'GET', 'exit', undefined, { uid });
  if (j.error) return give(r, name, null, j);
  const e = j.exit;
  if (!e || e.status !== 'APPROVED') return give(r, name, null, { error: 'Clearance is open only while the person is serving notice.' });
  const dept = (e.clearance || []).find((c: any) => c.deptId === deptId);
  if (!dept) return give(r, name, null, { error: 'That department is not in this exit\'s clearance list.' });
  if (!hr && dept.ownerUid !== r.ctx.uid) return give(r, name, null, { error: 'Only the owner of this department or HR can record its clearance.' });
  const note = cleanText(args?.note, 300);
  let dues = 0;
  if (status === 'DUES') {
    dues = Math.round(Number(args?.dues) * 100) / 100;
    if (!Number.isFinite(dues) || dues <= 0 || dues > 10_000_000) return give(r, name, null, { error: 'Ask for the amount owed.' });
    if (!note) return give(r, name, null, { error: 'Ask what the dues are for.' });
  }
  const who = cleanText(e.employee?.name, 80);
  const card = await makeProposal(r, 'exit_clearance', { uid, deptId, status, dues, note, label: cleanText(dept.label, 80), employee: who }, {
    title: `No-dues clearance: ${cleanText(dept.label, 80)} for ${who}`,
    lines: [`Now: ${STATUS_WORD[dept.status] || dept.status}`, `Set to: ${STATUS_WORD[status]}${status === 'DUES' ? ` (${money(dues)})` : ''}`, ...(note ? [`Note: ${note}`] : []), `Last working day: ${e.lastWorkingDay || 'not set'}`],
    confirmLabel: status === 'DUES' ? 'Confirm dues' : status === 'WAIVED' ? 'Confirm waive' : 'Confirm cleared', destructive: status === 'DUES',
  });
  return proposed(r, name, card);
}

/** Returns the tool result for a People tool, or null when `name` is not one of them. */
export async function runPeopleAgentTool(r: Run, name: string, args: any): Promise<string | null> {
  const def = PEOPLE_AGENT_TOOLS.find((t) => t.name === name);
  if (!def) return null;
  if (!mayUsePeopleTool(r.ctx, def)) return give(r, name, null, { error: 'Not available for your role.' });
  const today = istDay();
  switch (name) {
    case 'get_my_onboarding_tasks': {
      const j = await route(r, 'lifecycle', 'GET', 'onboarding-my');
      if (j.error) return give(r, name, null, j);
      return give(r, name, { kind: 'data', label: 'Your onboarding tasks' }, { today, ...summarizeTasks(Array.isArray(j.tasks) ? j.tasks : [], today), bankDetailsSubmitted: !!j.bankSubmitted });
    }
    case 'get_my_exit': {
      const j = await route(r, 'lifecycle', 'GET', 'exit-my');
      if (j.error) return give(r, name, null, j);
      const e = j.exit;
      if (!e) return give(r, name, { kind: 'data', label: 'Your exit' }, { hasExit: false, companyNoticeDays: j.noticeDays });
      return give(r, name, { kind: 'data', label: 'Your exit' }, { hasExit: true, ...exitRow(e), noticeServedDays: e.noticeServedDays, companyNoticeDays: j.noticeDays, clearanceDetail: e.status === 'APPROVED' ? summarizeClearance(e.clearance || []) : undefined });
    }
    case 'get_my_letters': {
      const j = await route(r, 'lifecycle', 'GET', 'my-letters');
      if (j.error) return give(r, name, null, j);
      const letters: any[] = Array.isArray(j.letters) ? j.letters : [];
      return give(r, name, { kind: 'data', label: 'Your letters' }, { count: letters.length, letters: letters.slice(0, 10).map((l) => ({ title: cleanText(l.title, 100), number: l.number, issuedOn: String(l.issuedAt || '').slice(0, 10) })) });
    }
    case 'get_exits': {
      const j = await route(r, 'lifecycle', 'GET', 'exits');
      if (j.error) return give(r, name, null, j);
      const list = Array.isArray(j.exits) ? j.exits : [];
      return give(r, name, { kind: 'data', label: 'Exits' }, { today, ...summarizeExits(list), note: list.length === 0 ? 'No exit cases are visible to this person.' : undefined });
    }
    case 'get_exit_details': {
      const uid = cleanUid(args?.uid);
      if (!uid) return give(r, name, null, { error: 'Use get_exits first to get the employee uid.' });
      const j = await route(r, 'lifecycle', 'GET', 'exit', undefined, { uid });
      if (j.error) return give(r, name, null, j);
      if (!j.exit) return give(r, name, null, { note: 'No exit case for that person.' });
      return give(r, name, { kind: 'data', label: 'Exit details' }, { ...exitRow(j.exit), clearanceDetail: summarizeClearance(j.exit.clearance || []) });
    }
    case 'get_onboarding_overview': {
      const j = await route(r, 'lifecycle', 'GET', 'onboarding');
      if (j.error) return give(r, name, null, j);
      return give(r, name, { kind: 'data', label: 'Onboarding' }, { today, ...summarizeOnboarding(Array.isArray(j.rows) ? j.rows : [], Array.isArray(j.withoutChecklist) ? j.withoutChecklist : []) });
    }
    case 'propose_task_done': return await proposeTaskDone(r, name, args);
    case 'propose_exit_decision': return await proposeExitDecision(r, name, args);
    case 'propose_exit_clearance': return await proposeExitClearance(r, name, args);
    default: return null;
  }
}
