/**
 * Employee records tool pack for the Ask HR agent. Registry and counting: shared/employeeAgentTools.ts.
 *
 * Every tool calls the same People route the screens use (`/api/leave/lifecycle-*`), with the signed-in person's own login,
 * so company and permission checks are the ones that already apply. Identity numbers are masked by the route before they
 * get here. Propose tools validate against the real record and save a confirm card; the action itself runs only in
 * assistantApi `confirm`, from the person's own click. Employees can only read their own record through the agent.
 */
import { give, makeProposal, proposed, route, istDay, str, type Run } from './agentKit.js';
import { cleanText, cleanUid } from '../../shared/leaveAgentTools.js';
import {
  EMPLOYEE_AGENT_TOOLS, FIELD_LABEL, checkProfileChanges, filterPeople, identityKnown, mayUseEmployeeTool, pendingOf, profileView, reviewQueue,
  selfStatus, summarizeCompleteness, summarizeFind, type FindFilter, type PersonRow, type ProfileChangeField,
} from '../../shared/employeeAgentTools.js';
import { IDENTITY_TYPES } from '../../shared/employeeIdentity.js';

const idLabel = (k: string) => IDENTITY_TYPES.find((t) => t.key === k)?.label || k;

async function rows(r: Run, self: boolean): Promise<{ rows: PersonRow[] } | { error: string }> {
  const j = await route(r, 'lifecycle', 'GET', 'people-review', undefined, self ? { self: '1' } : {});
  return j.error ? { error: j.error } : { rows: Array.isArray(j.rows) ? j.rows : [] };
}

async function proposeIdentityDecision(r: Run, name: string, args: any): Promise<string> {
  const uid = cleanUid(args?.uid);
  const type = str(args?.type, 40);
  const decision = String(args?.decision || '').toUpperCase();
  const note = cleanText(args?.note, 300);
  if (!uid || !identityKnown(type) || (decision !== 'APPROVE' && decision !== 'REJECT')) return give(r, name, null, { error: 'Give the uid and document type from get_identity_review_queue and a decision of APPROVE or REJECT.' });
  if (decision === 'REJECT' && !note) return give(r, name, null, { error: 'A reason is needed to reject. Ask the person for it, then try again.' });
  const all = await rows(r, false);
  if ('error' in all) return give(r, name, null, { error: all.error });
  const row = all.rows.find((x) => x.uid === uid);
  const doc = row && pendingOf(row).find(([t]) => t === type);
  if (!row || !doc) return give(r, name, null, { error: 'There is nothing waiting for approval for that person and document. Check get_identity_review_queue.' });
  const approve = decision === 'APPROVE';
  const [, info] = doc;
  const card = await makeProposal(r, 'identity_decision', { uid, type, approve, note, employee: cleanText(row.name, 80), document: idLabel(type) }, {
    title: `${approve ? 'Approve' : 'Reject'} ${idLabel(type)}: ${cleanText(row.name, 80)}`,
    lines: [
      `Employee: ${cleanText(row.name, 80)}${row.department ? ` (${cleanText(row.department, 60)})` : ''}`,
      `Number submitted: ${info.pendingMasked}`,
      ...(info.numberMasked ? [`Current approved number: ${info.numberMasked}`] : []),
      ...(note ? [`Reason: ${note}`] : []),
      approve ? 'Approving makes it the number on record. The employee is notified.' : 'The employee is told it was not approved and why.',
    ],
    confirmLabel: approve ? 'Confirm approve' : 'Confirm reject', destructive: !approve,
  });
  return proposed(r, name, card);
}

async function proposeProfileChange(r: Run, name: string, args: any): Promise<string> {
  const uid = cleanUid(args?.uid);
  if (!uid) return give(r, name, null, { error: 'Use find_employees first to get the employee uid.' });
  const chk = checkProfileChanges(args?.changes, istDay());
  if (chk.error) return give(r, name, null, { error: chk.error });
  const j = await route(r, 'lifecycle', 'GET', 'profile', undefined, { uid });
  if (j.error) return give(r, name, null, j);
  const p = j.profile;
  if (!p) return give(r, name, null, { error: 'Employee not found.' });
  const lines = Object.entries(chk.changes).map(([k, v]) => {
    const before = String(p[k] ?? '').trim();
    return `${FIELD_LABEL[k as ProfileChangeField]}: ${before || 'not set'} → ${v || 'cleared'}`;
  });
  const same = Object.entries(chk.changes).every(([k, v]) => String(p[k] ?? '').trim() === v);
  if (same) return give(r, name, null, { note: 'That is already what the record says. Nothing to change.' });
  const card = await makeProposal(r, 'profile_change', { uid, changes: chk.changes, employee: cleanText(p.name, 80) }, {
    title: `Update profile: ${cleanText(p.name, 80)}`, lines: [`Employee: ${cleanText(p.name, 80)} (${p.empId})`, ...lines], confirmLabel: 'Confirm change',
  });
  return proposed(r, name, card);
}

/** Returns the tool result for an Employee tool, or null when `name` is not one of them. */
export async function runEmployeeAgentTool(r: Run, name: string, args: any): Promise<string | null> {
  const def = EMPLOYEE_AGENT_TOOLS.find((t) => t.name === name);
  if (!def) return null;
  if (!mayUseEmployeeTool(r.ctx, def)) return give(r, name, null, { error: 'Not available for your role.' });
  const today = istDay();
  switch (name) {
    case 'get_my_profile_status': {
      const all = await rows(r, true);
      if ('error' in all) return give(r, name, null, { error: all.error });
      const mine = all.rows.find((x) => x.uid === r.ctx.uid);
      if (!mine) return give(r, name, null, { note: 'No employee record was found for this person.' });
      return give(r, name, { kind: 'data', label: 'Your employee record' }, selfStatus(mine));
    }
    case 'get_profile_completeness': {
      const all = await rows(r, false);
      if ('error' in all) return give(r, name, null, { error: all.error });
      return give(r, name, { kind: 'data', label: 'Employee records' }, summarizeCompleteness(all.rows));
    }
    case 'find_employees': {
      const all = await rows(r, false);
      if ('error' in all) return give(r, name, null, { error: all.error });
      const f: FindFilter = {
        query: str(args?.query, 80), department: str(args?.department, 80), joinedFrom: str(args?.joinedFrom, 10) || undefined, joinedTo: str(args?.joinedTo, 10) || undefined,
        missing: str(args?.missing, 20) || undefined, pendingReview: args?.pendingReview === true,
      };
      return give(r, name, { kind: 'data', label: 'Employee search' }, { today, ...summarizeFind(filterPeople(all.rows, f)) });
    }
    case 'get_employee_profile': {
      const uid = cleanUid(args?.uid);
      if (!uid) return give(r, name, null, { error: 'Use find_employees first to get the employee uid.' });
      const all = await rows(r, false);
      if ('error' in all) return give(r, name, null, { error: all.error });
      const row = all.rows.find((x) => x.uid === uid);
      return row ? give(r, name, { kind: 'data', label: 'Employee profile' }, profileView(row)) : give(r, name, null, { note: 'No active employee with that uid.' });
    }
    case 'get_identity_review_queue': {
      const all = await rows(r, false);
      if ('error' in all) return give(r, name, null, { error: all.error });
      return give(r, name, { kind: 'data', label: 'Identity review queue' }, { today, ...reviewQueue(all.rows, today) });
    }
    case 'propose_identity_decision': return await proposeIdentityDecision(r, name, args);
    case 'propose_profile_change': return await proposeProfileChange(r, name, args);
    default: return null;
  }
}
