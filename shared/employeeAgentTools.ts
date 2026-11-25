/**
 * Employee (records) agent: tool registry and the counting that must NOT be left to the model.
 * Pure code (no database, no network), tested in tests/employeeAgent.test.ts.
 *
 * Same pattern as the Leave and People agents: read tools look things up; `propose` tools only create a confirm card and
 * nothing changes until the person presses Confirm. Employees only READ their own record here (changing ID and bank data
 * stays on the form). Identity and account numbers are always masked: the model never sees a full number.
 *
 * `access`:  all     every signed-in person (the route behind the tool only returns their own record)
 *            manage  needs lifecycle.manage (or company admin)
 * This decides which tools the model is told about. It is not the security boundary: every tool calls the same People
 * route the screens use, with the person's own login, and that route checks company and permission again.
 */
import { hasPerm } from './permissions.js';
import { cleanText, daysBetween } from './leaveAgentTools.js';
import { IDENTITY_TYPES, maskIdentity } from './employeeIdentity.js';

export type EmployeeToolAccess = 'all' | 'manage';
export interface EmployeeAgentTool { name: string; kind: 'read' | 'propose'; access: EmployeeToolAccess; description: string; parameters: Record<string, any> }

const none = { type: 'object', properties: {}, additionalProperties: false };
const obj = (properties: Record<string, any>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const DATE = { type: 'string', description: 'YYYY-MM-DD' };

/** What a record needs before HR calls it complete. */
export const GAPS = ['PAN', 'AADHAAR', 'MOBILE', 'QUALIFICATION', 'FAMILY', 'PERSONAL'] as const;
export type Gap = (typeof GAPS)[number];
export const GAP_LABEL: Record<Gap, string> = {
  PAN: 'PAN', AADHAAR: 'Aadhaar', MOBILE: 'Mobile number', QUALIFICATION: 'Qualification', FAMILY: 'Family details', PERSONAL: 'Personal information',
};

/** Fields HR can change through the agent. Names, dates and contact details only; nothing about pay, roles or access. */
export const PROFILE_CHANGE_FIELDS = {
  joinDate: 'date', confirmationDate: 'date', dob: 'date', mobile: 'text', gender: 'gender', machineCode: 'text', firstName: 'text', middleName: 'text', lastName: 'text',
} as const;
export type ProfileChangeField = keyof typeof PROFILE_CHANGE_FIELDS;
export const FIELD_LABEL: Record<ProfileChangeField, string> = {
  joinDate: 'Joining date', confirmationDate: 'Confirmation date', dob: 'Date of birth', mobile: 'Mobile', gender: 'Gender', machineCode: 'Machine code',
  firstName: 'First name', middleName: 'Middle name', lastName: 'Last name',
};

export const EMPLOYEE_AGENT_TOOLS: EmployeeAgentTool[] = [
  {
    name: 'get_my_profile_status', kind: 'read', access: 'all',
    description: 'The signed-in person\'s OWN employee record status: which details are missing (PAN, Aadhaar, mobile, qualification, family, personal information), and the status of each identity document (approved, waiting for HR, or not approved with HR\'s reason). Numbers are masked. Use for "what is missing on my profile" or "was my PAN approved".',
    parameters: none,
  },
  {
    name: 'get_profile_completeness', kind: 'read', access: 'manage',
    description: 'HR view of the whole company: how many employee records are complete, how many are missing each detail, identity documents waiting for review, and the people with the most gaps.',
    parameters: none,
  },
  {
    name: 'find_employees', kind: 'read', access: 'manage',
    description: 'HR search over active employees. Combine filters: a name or employee id fragment, a department, a joining date range, a missing detail, or only people whose identity document is waiting for review. Returns the count and up to 20 people with their uid.',
    parameters: obj({
      query: { type: 'string', description: 'Part of a name or employee id' }, department: { type: 'string' },
      joinedFrom: DATE, joinedTo: DATE,
      missing: { type: 'string', enum: [...GAPS], description: 'Only people missing this detail' },
      pendingReview: { type: 'boolean', description: 'Only people with an identity document waiting for HR' },
    }),
  },
  {
    name: 'get_employee_profile', kind: 'read', access: 'manage',
    description: 'HR view of one employee: department, title, joining date, mobile, what is missing, and the status of each identity document (masked). Needs the employee uid from find_employees.',
    parameters: obj({ uid: { type: 'string' } }, ['uid']),
  },
  {
    name: 'get_identity_review_queue', kind: 'read', access: 'manage',
    description: 'HR view: identity documents (PAN, Aadhaar and so on) that an employee submitted and that are waiting for approval, oldest first, with the days waited and the masked number.',
    parameters: none,
  },
  {
    name: 'propose_identity_decision', kind: 'propose', access: 'manage',
    description: 'Prepares approving or rejecting ONE identity document that is waiting for HR. Needs the employee uid and the document type from get_identity_review_queue. A rejection needs a reason that the person gave you. This only shows a confirm card; nothing changes until the person presses Confirm.',
    parameters: obj({
      uid: { type: 'string' }, type: { type: 'string', enum: IDENTITY_TYPES.map((t) => t.key) },
      decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, note: { type: 'string', description: 'Required for REJECT' },
    }, ['uid', 'type', 'decision']),
  },
  {
    name: 'propose_profile_change', kind: 'propose', access: 'manage',
    description: 'Prepares changing details on one employee\'s record: joinDate, confirmationDate, dob (YYYY-MM-DD), mobile, gender (Male, Female or Other), machineCode, firstName, middleName, lastName. Department, title, roles, pay and bank details cannot be changed here. Needs the uid from find_employees. This only shows a confirm card; nothing changes until the person presses Confirm.',
    parameters: obj({
      uid: { type: 'string' },
      changes: { type: 'object', description: 'Only the fields to change', additionalProperties: false, properties: {
        joinDate: DATE, confirmationDate: DATE, dob: DATE, mobile: { type: 'string' }, gender: { type: 'string', enum: ['Male', 'Female', 'Other'] },
        machineCode: { type: 'string' }, firstName: { type: 'string' }, middleName: { type: 'string' }, lastName: { type: 'string' },
      } },
    }, ['uid', 'changes']),
  },
];

export interface EmployeeWho { perms?: string[] | null; isCompanyAdmin?: boolean }
export const canManageEmployees = (w: EmployeeWho) => !!w.isCompanyAdmin || hasPerm(w.perms, 'lifecycle.manage');
export const mayUseEmployeeTool = (w: EmployeeWho, t: Pick<EmployeeAgentTool, 'access'>) => t.access === 'all' || canManageEmployees(w);
export const employeeToolsFor = (w: EmployeeWho): EmployeeAgentTool[] => EMPLOYEE_AGENT_TOOLS.filter((t) => mayUseEmployeeTool(w, t));

export function employeeRoleLine(w: EmployeeWho): string {
  return canManageEmployees(w)
    ? 'For employee records this person is HR: they can search people, see profile gaps, review identity documents and prepare edits.'
    : 'For employee records this person can only see their own profile status; they change their details on the Employee screens.';
}

// ------------------------------------------------------------------ records, as the route sends them

export interface IdentityInfo { status: string; hasNumber: boolean; numberMasked?: string; pendingMasked?: string; pendingSince?: string; note?: string }
export interface PersonRow {
  uid: string; name: string; empId: string; department: string; title: string; joinDate: string; mobile: string;
  identity: Record<string, IdentityInfo>; qualifications: number; family: number; personal: boolean;
}

const idLabel = (key: string) => IDENTITY_TYPES.find((t) => t.key === key)?.label || key;
export const identityKnown = (key: string) => IDENTITY_TYPES.some((t) => t.key === key);

/** Missing means nothing on file and nothing waiting for HR. A document waiting for review is not a gap. */
export function gapsOf(r: PersonRow): Gap[] {
  const out: Gap[] = [];
  for (const k of ['PAN', 'AADHAAR'] as const) {
    const i = r.identity[k];
    if (!i || (!i.hasNumber && i.status !== 'PENDING')) out.push(k);
  }
  if (!String(r.mobile || '').trim()) out.push('MOBILE');
  if (r.qualifications < 1) out.push('QUALIFICATION');
  if (r.family < 1) out.push('FAMILY');
  if (!r.personal) out.push('PERSONAL');
  return out;
}

export const pendingOf = (r: PersonRow) => Object.entries(r.identity).filter(([, i]) => i.status === 'PENDING' && i.pendingMasked);

export function identityList(r: PersonRow) {
  return IDENTITY_TYPES.map((t) => {
    const i = r.identity[t.key];
    const status = !i ? 'not provided' : i.status === 'PENDING' ? 'waiting for HR' : i.status === 'REJECTED' ? 'not approved' : i.hasNumber ? 'approved' : 'not provided';
    return { type: t.key, document: t.label, status, number: i?.numberMasked || null, newNumberWaiting: i?.status === 'PENDING' ? i.pendingMasked || null : null, hrReason: i?.status === 'REJECTED' || (i?.note && i.status !== 'APPROVED') ? cleanText(i?.note, 160) : null };
  });
}

export function selfStatus(r: PersonRow) {
  const gaps = gapsOf(r);
  const pend = pendingOf(r).length;
  return {
    name: cleanText(r.name, 80), complete: gaps.length === 0, missing: gaps.map((g) => GAP_LABEL[g]), documentsWaitingForHr: pend,
    mobileOnFile: !!r.mobile, qualifications: r.qualifications, familyMembers: r.family, identity: identityList(r),
  };
}

export function profileView(r: PersonRow) {
  const gaps = gapsOf(r);
  return {
    uid: r.uid, name: cleanText(r.name, 80), empId: r.empId, department: cleanText(r.department, 60), title: cleanText(r.title, 80), joinDate: r.joinDate || null,
    mobileOnFile: !!r.mobile, missing: gaps.map((g) => GAP_LABEL[g]), complete: gaps.length === 0, qualifications: r.qualifications, familyMembers: r.family, identity: identityList(r),
  };
}

export interface FindFilter { query?: string; department?: string; joinedFrom?: string; joinedTo?: string; missing?: string; pendingReview?: boolean }

export function filterPeople(rows: PersonRow[], f: FindFilter): PersonRow[] {
  const q = String(f.query || '').trim().toLowerCase();
  const dep = String(f.department || '').trim().toLowerCase();
  const gap = (GAPS as readonly string[]).includes(String(f.missing)) ? (f.missing as Gap) : null;
  return rows.filter((r) => {
    if (q && !`${r.name} ${r.empId}`.toLowerCase().includes(q)) return false;
    if (dep && String(r.department || '').toLowerCase() !== dep) return false;
    if (f.joinedFrom && (!r.joinDate || r.joinDate < f.joinedFrom)) return false;
    if (f.joinedTo && (!r.joinDate || r.joinDate > f.joinedTo)) return false;
    if (gap && !gapsOf(r).includes(gap)) return false;
    if (f.pendingReview && pendingOf(r).length === 0) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function summarizeFind(rows: PersonRow[], cap = 20) {
  return {
    count: rows.length,
    people: rows.slice(0, cap).map((r) => ({
      uid: r.uid, name: cleanText(r.name, 80), empId: r.empId, department: cleanText(r.department, 60), joinDate: r.joinDate || null,
      missing: gapsOf(r).map((g) => GAP_LABEL[g]), documentsWaiting: pendingOf(r).length,
    })),
    shown: Math.min(rows.length, cap),
  };
}

export function summarizeCompleteness(rows: PersonRow[], cap = 12) {
  const by: Record<string, number> = {};
  let complete = 0;
  for (const r of rows) {
    const g = gapsOf(r);
    if (!g.length) complete++;
    g.forEach((x) => { by[GAP_LABEL[x]] = (by[GAP_LABEL[x]] || 0) + 1; });
  }
  const worst = rows.map((r) => ({ r, n: gapsOf(r).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.r.name.localeCompare(b.r.name));
  return {
    people: rows.length, complete, incomplete: rows.length - complete,
    missingByDetail: by,
    identityDocumentsWaiting: rows.reduce((n, r) => n + pendingOf(r).length, 0),
    mostGaps: worst.slice(0, cap).map((x) => ({ uid: x.r.uid, name: cleanText(x.r.name, 80), department: cleanText(x.r.department, 60), missing: gapsOf(x.r).map((g) => GAP_LABEL[g]) })),
  };
}

export function reviewQueue(rows: PersonRow[], today: string, cap = 20) {
  const items = rows.flatMap((r) => pendingOf(r).map(([type, i]) => ({
    uid: r.uid, name: cleanText(r.name, 80), department: cleanText(r.department, 60), type, document: idLabel(type),
    newNumber: i.pendingMasked || '', currentNumber: i.numberMasked || null, submittedOn: i.pendingSince || null,
    daysWaiting: i.pendingSince ? Math.max(0, daysBetween(i.pendingSince, today)) : null,
  }))).sort((a, b) => (b.daysWaiting ?? -1) - (a.daysWaiting ?? -1) || a.name.localeCompare(b.name));
  return { waiting: items.length, items: items.slice(0, cap) };
}

// ------------------------------------------------------------------ validating a proposed profile change

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function checkProfileChanges(input: unknown, today: string): { changes: Record<string, string>; error?: string } {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(src)) {
    const kind = (PROFILE_CHANGE_FIELDS as Record<string, string>)[k];
    if (!kind) return { changes: {}, error: `${k} cannot be changed here. Department, title, roles, pay and bank details are changed on their own screens.` };
    const v = String(raw ?? '').trim();
    if (kind === 'date') {
      if (!isDate(v)) return { changes: {}, error: `${FIELD_LABEL[k as ProfileChangeField]} needs a date as YYYY-MM-DD.` };
      if (k === 'dob' && (v < '1900-01-01' || v > today)) return { changes: {}, error: 'That date of birth is not valid.' };
      if (k === 'joinDate' && v < '1950-01-01') return { changes: {}, error: 'That joining date is not valid.' };
    } else if (kind === 'gender') {
      if (!['Male', 'Female', 'Other'].includes(v)) return { changes: {}, error: 'Gender must be Male, Female or Other.' };
    } else if (k === 'mobile') {
      if (v && !/^[0-9+()\-\s]{6,20}$/.test(v)) return { changes: {}, error: 'Enter a valid mobile number.' };
    }
    out[k] = cleanText(v, k === 'mobile' ? 20 : 80);
  }
  if (!Object.keys(out).length) return { changes: {}, error: 'Say which detail to change and to what.' };
  return { changes: out };
}
