/**
 * Moving people between the organisations of one account.
 *
 * - The group administrator moves people directly. HR can propose a move; the group administrator approves it.
 * - The same person record (same user id, same login) moves. History stays in the old organisation; the profile
 *   (identity, personal, family, qualification) is copied to the new one. Leave balances carry over only if asked.
 * - Everything is checked against the account in the database. Nothing here trusts the token for more than "who is asking".
 */
import { adminAuth, adminDb } from './firebaseAdmin.js';
import { authenticate, requireActiveTenant, AuthError } from './authContext.js';
import { hasPerm } from '../../shared/permissions.js';
import { requireGroupAdmin, type OrgDeps, type OrgResult } from './orgAdmin.js';
import { audit, balanceOf, entryData, ledgerRef, loadSettings, userLedger } from './leaveCore.js';
import { cycleOf, isIsoDate, istToday, typeStartMonth } from '../../shared/leaveEngine.js';
import type { AccountDoc } from './accounts.js';

const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const ok = (extra: Record<string, unknown> = {}): OrgResult => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string): OrgResult => ({ status, json: { success: false, error } });
const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
const MAX_PEOPLE = 200;

export type CarryMode = 'none' | 'all' | 'choose';
export interface TransferInput {
  toCompanyId: string;
  uids: string[];
  effectiveDate?: string;
  carry?: CarryMode;
  /** With carry = 'choose': names or codes of the leave types to carry. */
  carryTypes?: string[];
  /** Overrides the batch rule for one person. */
  perPerson?: Record<string, 'none' | 'all'>;
  note?: string;
}

export interface TransferOutcome {
  uid: string;
  name: string;
  ok: boolean;
  error?: string;
  fromCompanyId?: string;
  fromEmpId?: string;
  toEmpId?: string;
  carried?: { type: string; days: number }[];
  notCarried?: string[];
  cancelledRequests?: number;
  reportsCleared?: number;
  departmentsCleared?: number;
}

const COMPOSITE = ['employeeProfiles', 'employeePersonal', 'personalDates'] as const;

async function loadCompany(id: string) {
  const s = await db().collection('companies').doc(id).get();
  return s.exists ? (s.data() as any) : null;
}

async function findEmployee(uid: string): Promise<{ ref: any; data: any } | null> {
  const direct = db().collection('employees').doc(uid);
  const d = await direct.get();
  if (d.exists) return { ref: direct, data: d.data() };
  const q = await db().collection('employees').where('authUid', '==', uid).limit(1).get();
  return q.empty ? null : { ref: q.docs[0].ref, data: q.docs[0].data() };
}

/** Copies one person's profile data from one organisation to another. The old organisation keeps its copy. */
async function copyProfile(from: string, to: string, uid: string, oldCode: string): Promise<void> {
  for (const col of COMPOSITE) {
    const s = await db().collection(col).doc(`${from}__${uid}`).get();
    if (!s.exists) continue;
    const data = { ...(s.data() as any), companyId: to, uid };
    if (col === 'employeeProfiles') data.oldCode = oldCode;
    await db().collection(col).doc(`${to}__${uid}`).set(data);
  }
  // Without an existing profile, still remember the old code.
  const prof = await db().collection('employeeProfiles').doc(`${to}__${uid}`).get();
  if (!prof.exists) await db().collection('employeeProfiles').doc(`${to}__${uid}`).set({ companyId: to, uid, oldCode, updatedAt: nowIso() });

  const ids = await db().collection('employeeIdentities').where('companyId', '==', from).where('uid', '==', uid).get();
  for (const d of ids.docs) {
    const x = d.data() as any;
    await db().collection('employeeIdentities').doc(`${to}__${uid}__${x.type}`).set({ ...x, companyId: to });
  }
  const copyWithData = async (metaCol: string, dataCol: string | null) => {
    const snap = await db().collection(metaCol).where('companyId', '==', from).where('uid', '==', uid).get();
    for (const d of snap.docs) {
      const newRef = db().collection(metaCol).doc();
      await newRef.set({ ...(d.data() as any), id: newRef.id, companyId: to });
      if (dataCol) {
        const blob = await db().collection(dataCol).doc(d.id).get();
        if (blob.exists) await db().collection(dataCol).doc(newRef.id).set({ ...(blob.data() as any), companyId: to });
      }
    }
  };
  await copyWithData('employeeIdentityFiles', 'employeeIdentityData');
  await copyWithData('employeeFamily', null);
  await copyWithData('employeeQualifications', 'employeeQualificationData');
}

/** Opening balances in the new organisation for the leave types that exist there (matched by code or name). */
async function carryBalances(from: string, to: string, uid: string, mode: 'all' | 'choose', only: string[], fromName: string, actor: string, date: string) {
  const [fs, ts, entries] = await Promise.all([loadSettings(from), loadSettings(to), userLedger(from, uid)]);
  const wanted = new Set(only.map((x) => x.toLowerCase()));
  const carried: { type: string; days: number }[] = [];
  const notCarried: string[] = [];
  for (const ft of fs.settings.types) {
    if (mode === 'choose' && !wanted.has(ft.name.toLowerCase()) && !wanted.has(String(ft.code || '').toLowerCase())) continue;
    const fromCycle = cycleOf(date, typeStartMonth(ft, fs.settings)).key;
    const bal = balanceOf(entries, ft.id, fromCycle);
    if (!bal) continue;
    const tt = ts.settings.types.find((t) => t.name.toLowerCase() === ft.name.toLowerCase() || (!!t.code && t.code.toLowerCase() === String(ft.code || '').toLowerCase()));
    if (!tt) { notCarried.push(`${ft.name} (no matching leave type in the new organisation)`); continue; }
    const toCycle = cycleOf(date, typeStartMonth(tt, ts.settings)).key;
    await ledgerRef(`OPEN_${uid}_${tt.id}_${toCycle}`).set(entryData({
      companyId: to, uid, typeId: tt.id, cycle: toCycle, delta: bal, kind: 'OPENING', date, note: `Carried from ${fromName}`, by: actor,
    }));
    // The old organisation's balance is closed out so the days are not counted twice.
    const out = ledgerRef(`XFER_${uid}_${ft.id}_${fromCycle}`);
    await out.set(entryData({ companyId: from, uid, typeId: ft.id, cycle: fromCycle, delta: -bal, kind: 'CARRY_OUT', date, note: 'Transferred to another organisation', by: actor }));
    carried.push({ type: tt.name, days: bal });
  }
  return { carried, notCarried };
}

async function transferOne(uid: string, input: Required<Pick<TransferInput, 'toCompanyId'>> & TransferInput, ctx: { account: AccountDoc; actor: { uid: string; name: string }; to: any; date: string }, deps: OrgDeps): Promise<TransferOutcome> {
  const emp = await findEmployee(uid);
  if (!emp) return { uid, name: uid, ok: false, error: 'Employee not found.' };
  const name = String(emp.data.name || emp.data.email || uid);
  const out = (error: string): TransferOutcome => ({ uid, name, ok: false, error });
  const from = String(emp.data.companyId || '');
  if (uid === ctx.actor.uid) return out('You cannot transfer yourself.');
  const fromCompany = await loadCompany(from);
  if (!fromCompany || fromCompany.accountId !== ctx.account.id) return out('This person is not in an organisation of your account.');
  if (from === input.toCompanyId) return out('Already in that organisation.');
  if (emp.data.active === false) return out('This person is inactive. Reactivate them before transferring.');

  const fromEmpId = String(emp.data.empId || '');
  const toEmpId = await deps.nextEmployeeId!(input.toCompanyId);

  await copyProfile(from, input.toCompanyId, uid, fromEmpId);

  // Leave balances
  const mode: CarryMode = input.perPerson?.[uid] ?? input.carry ?? 'none';
  let carried: { type: string; days: number }[] = [];
  let notCarried: string[] = [];
  if (mode !== 'none') ({ carried, notCarried } = await carryBalances(from, input.toCompanyId, uid, mode, input.carryTypes || [], fromCompany.name, ctx.actor.name, ctx.date));

  // New leave profile: no manager, default policy, accrual starts at the transfer date.
  const oldLp = await db().collection('leaveProfiles').doc(`${from}__${uid}`).get();
  await db().collection('leaveProfiles').doc(`${input.toCompanyId}__${uid}`).set({
    companyId: input.toCompanyId, uid, managerUid: '', joinDate: ctx.date, gender: (oldLp.data() as any)?.gender || '', updatedAt: nowIso(),
  });

  // Loose ends in the old organisation
  let cancelledRequests = 0, reportsCleared = 0, departmentsCleared = 0;
  const reqs = await db().collection('leaveRequests').where('companyId', '==', from).where('uid', '==', uid).get();
  for (const r of reqs.docs) {
    const st = String((r.data() as any).status);
    if (['PENDING', 'INFO_REQUESTED', 'CANCEL_REQUESTED'].includes(st)) {
      await r.ref.update({ status: 'CANCELLED', updatedAt: nowIso(), transferNote: 'Cancelled because the employee was transferred to another organisation.' });
      cancelledRequests++;
    }
  }
  const reports = await db().collection('leaveProfiles').where('companyId', '==', from).where('managerUid', '==', uid).get();
  for (const p of reports.docs) { await p.ref.update({ managerUid: '', updatedAt: nowIso() }); reportsCleared++; }
  const heads = await db().collection('departments').where('companyId', '==', from).where('headUserId', '==', uid).get();
  for (const d of heads.docs) { await d.ref.update({ headUserId: '', updatedAt: nowIso() }); departmentsCleared++; }

  // The person moves: same record, new organisation, basic role, new code.
  await emp.ref.update({
    companyId: input.toCompanyId, companyName: ctx.to.name, empId: toEmpId, departmentId: '', departmentName: '',
    roleIds: [`${input.toCompanyId}_employee`], roleNames: ['Employee'], role: 'EMPLOYEE', perms: [],
    previousEmpId: fromEmpId, transferredFromCompanyId: from, transferredAt: nowIso(), updatedAt: nowIso(),
  });
  await deps.syncUser(uid);
  await adminAuth().revokeRefreshTokens(uid).catch(() => {});

  const link = db().collection('employmentHistory').doc();
  await link.set({
    id: link.id, accountId: ctx.account.id, uid, name, fromCompanyId: from, fromCompanyName: fromCompany.name, fromEmpId,
    toCompanyId: input.toCompanyId, toCompanyName: ctx.to.name, toEmpId, effectiveDate: ctx.date, transferredBy: ctx.actor.name,
    carried, note: str(input.note, 300), at: nowIso(),
  });
  await audit(from, 'employee', uid, 'TRANSFERRED_OUT', ctx.actor, { company: fromCompany.name, empId: fromEmpId }, { company: ctx.to.name, effectiveDate: ctx.date });
  await audit(input.toCompanyId, 'employee', uid, 'TRANSFERRED_IN', ctx.actor, { company: fromCompany.name, empId: fromEmpId }, { company: ctx.to.name, empId: toEmpId, carried });
  return { uid, name, ok: true, fromCompanyId: from, fromEmpId, toEmpId, carried, notCarried, cancelledRequests, reportsCleared, departmentsCleared };
}

/** Validates the batch, then moves each person. A problem with one person never stops the others. */
export async function executeTransfers(account: AccountDoc, actor: { uid: string; name: string }, input: TransferInput, deps: OrgDeps): Promise<OrgResult> {
  const toCompanyId = str(input.toCompanyId, 128);
  const uids = [...new Set((Array.isArray(input.uids) ? input.uids : []).map((u) => str(u, 128)).filter(Boolean))];
  if (!toCompanyId) return fail(400, 'Choose the organisation to move people into.');
  if (!uids.length) return fail(400, 'Choose at least one person.');
  if (uids.length > MAX_PEOPLE) return fail(400, `Move at most ${MAX_PEOPLE} people at a time.`);
  const to = await loadCompany(toCompanyId);
  if (!to) return fail(404, 'Organisation not found.');
  if (to.accountId !== account.id) return fail(403, 'That organisation does not belong to your account.');
  if (to.status !== 'ACTIVE') return fail(400, `${to.name} is not active.`);
  const role = await db().collection('roles').doc(`${toCompanyId}_employee`).get();
  if (!role.exists) return fail(400, `${to.name} has no Employee role yet. Set it up first.`);
  const date = input.effectiveDate ? str(input.effectiveDate, 10) : istToday();
  if (!isIsoDate(date)) return fail(400, 'Enter the effective date as YYYY-MM-DD.');
  if (date > istToday()) return fail(400, 'Future-dated transfers are not supported yet. Use today or an earlier date.');
  const carry = input.carry ?? 'none';
  if (!['none', 'all', 'choose'].includes(carry)) return fail(400, 'Leave balance option must be none, all or choose.');

  const results: TransferOutcome[] = [];
  for (const uid of uids) {
    try {
      results.push(await transferOne(uid, { ...input, toCompanyId, carry }, { account, actor, to, date }, deps));
    } catch (e: any) {
      results.push({ uid, name: uid, ok: false, error: String(e?.message || 'Transfer failed.').slice(0, 200) });
    }
  }
  const moved = results.filter((r) => r.ok).length;
  await db().collection('accountAudit').doc(`aa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`).set({
    accountId: account.id, action: 'TRANSFER', by: actor.uid, at: nowIso(), to: toCompanyId, requested: uids.length, moved,
  });
  return ok({ moved, failed: results.length - moved, results });
}

async function actorName(uid: string, fallback: string): Promise<string> {
  const e = await findEmployee(uid);
  return String(e?.data?.name || fallback);
}

async function transferPeople(headers: Record<string, any>, body: any, deps: OrgDeps): Promise<OrgResult> {
  const { ctx, account } = await requireGroupAdmin(headers);
  return executeTransfers(account, { uid: ctx.uid, name: await actorName(ctx.uid, ctx.email) }, body as TransferInput, deps);
}

const canPropose = (perms: string[], adm: boolean) => adm || hasPerm(perms, 'lifecycle.manage') || hasPerm(perms, 'leave.manage');

/** HR (or a company admin) proposes moving people out of their own organisation; the group admin decides. */
async function proposeTransfer(headers: Record<string, any>, body: any): Promise<OrgResult> {
  const ctx = await requireActiveTenant(headers);
  if (!canPropose(ctx.perms, ctx.isCompanyAdmin)) throw new AuthError(403, 'You do not have permission to propose a transfer.');
  const from = await loadCompany(ctx.companyId!);
  if (!from?.accountId) return fail(400, 'Your organisation is not part of an account.');
  const toCompanyId = str(body?.toCompanyId, 128);
  const to = await loadCompany(toCompanyId);
  if (!to) return fail(404, 'Organisation not found.');
  if (to.accountId !== from.accountId || toCompanyId === ctx.companyId) return fail(403, 'Choose another organisation of the same account.');
  const uids: string[] = [...new Set((Array.isArray(body?.uids) ? body.uids : []).map((u: unknown) => str(u, 128)).filter(Boolean))] as string[];
  if (!uids.length || uids.length > MAX_PEOPLE) return fail(400, `Choose between 1 and ${MAX_PEOPLE} people.`);
  for (const uid of uids) {
    const e = await findEmployee(uid);
    if (!e || e.data.companyId !== ctx.companyId) return fail(403, 'You can only propose moving people from your own organisation.');
  }
  const ref = db().collection('transferRequests').doc();
  // Only defined values are stored (the database refuses undefined).
  const input: TransferInput = { toCompanyId, uids, note: str(body?.note, 300) };
  if (str(body?.effectiveDate, 10)) input.effectiveDate = str(body.effectiveDate, 10);
  if (body?.carry) input.carry = body.carry;
  if (Array.isArray(body?.carryTypes)) input.carryTypes = body.carryTypes.map((x: unknown) => str(x, 80));
  if (body?.perPerson && typeof body.perPerson === 'object') input.perPerson = Object.fromEntries(Object.entries(body.perPerson).filter(([, v]) => v === 'none' || v === 'all')) as TransferInput['perPerson'];
  const by = await actorName(ctx.uid, ctx.email);
  await ref.set({ id: ref.id, accountId: from.accountId, fromCompanyId: ctx.companyId, fromCompanyName: from.name, toCompanyName: to.name, input, status: 'PENDING', proposedBy: by, proposedByUid: ctx.uid, createdAt: nowIso() });
  return ok({ id: ref.id, status: 'PENDING' });
}

async function listProposals(headers: Record<string, any>): Promise<OrgResult> {
  const ctx = await authenticate(headers);
  if (ctx.isGroupAdmin && ctx.accountId) {
    const { account } = await requireGroupAdmin(headers);
    const snap = await db().collection('transferRequests').where('accountId', '==', account.id).get();
    return ok({ requests: snap.docs.map((d: any) => d.data()).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))) });
  }
  const t = await requireActiveTenant(headers);
  if (!canPropose(t.perms, t.isCompanyAdmin)) throw new AuthError(403, 'You do not have permission to see transfer requests.');
  const snap = await db().collection('transferRequests').where('fromCompanyId', '==', t.companyId).get();
  return ok({ requests: snap.docs.map((d: any) => d.data()).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))) });
}

async function decideProposal(headers: Record<string, any>, body: any, deps: OrgDeps): Promise<OrgResult> {
  const { ctx, account } = await requireGroupAdmin(headers);
  const ref = db().collection('transferRequests').doc(str(body?.id, 128));
  const snap = await ref.get();
  if (!snap.exists) return fail(404, 'Transfer request not found.');
  const req = snap.data() as any;
  if (req.accountId !== account.id) return fail(403, 'That request belongs to another account.');
  if (req.status !== 'PENDING') return fail(409, 'This request has already been decided.');
  const by = await actorName(ctx.uid, ctx.email);
  if (body?.approve !== true) {
    await ref.update({ status: 'REJECTED', decidedBy: by, decidedAt: nowIso(), decisionNote: str(body?.note, 300) });
    return ok({ status: 'REJECTED' });
  }
  await ref.update({ status: 'APPROVING', decidedBy: by, decidedAt: nowIso() }); // blocks a second click while it runs
  const done = await executeTransfers(account, { uid: ctx.uid, name: by }, req.input, deps);
  if (done.status !== 200) { await ref.update({ status: 'PENDING', decidedBy: null, decidedAt: null }); return done; }
  await ref.update({ status: 'APPROVED', moved: done.json.moved, failed: done.json.failed, results: done.json.results });
  return ok({ status: 'APPROVED', ...done.json });
}

/** HR/admin of the person's current organisation: their earlier employment inside the account (leave and a short audit trail). */
async function previousEmployment(headers: Record<string, any>, body: any): Promise<OrgResult> {
  const ctx = await requireActiveTenant(headers);
  if (!(ctx.isGroupAdmin || canPropose(ctx.perms, ctx.isCompanyAdmin))) throw new AuthError(403, 'You do not have permission to see this.');
  const uid = str(body?.uid, 128);
  const emp = await findEmployee(uid);
  if (!emp || emp.data.companyId !== ctx.companyId) return fail(404, 'Employee not found.');
  const links = (await db().collection('employmentHistory').where('uid', '==', uid).get()).docs.map((d: any) => d.data() as any).sort((a: any, b: any) => String(a.at).localeCompare(String(b.at)));
  const employments = [];
  for (const l of links) {
    const [reqs, aud, entries] = await Promise.all([
      db().collection('leaveRequests').where('companyId', '==', l.fromCompanyId).where('uid', '==', uid).get(),
      db().collection('leaveAudit').where('companyId', '==', l.fromCompanyId).where('entityId', '==', uid).get(),
      userLedger(l.fromCompanyId, uid),
    ]);
    const bal: Record<string, number> = {};
    for (const e of entries) bal[`${e.typeId}|${e.cycle}`] = Math.round(((bal[`${e.typeId}|${e.cycle}`] || 0) + e.delta) * 100) / 100;
    employments.push({
      organisation: l.fromCompanyName, empId: l.fromEmpId, until: l.effectiveDate, movedTo: l.toCompanyName,
      leave: reqs.docs.map((d: any) => d.data() as any).sort((a: any, b: any) => String(b.from).localeCompare(String(a.from))).slice(0, 200)
        .map((r: any) => ({ type: r.typeName, from: r.from, to: r.to, days: r.days, status: r.status })),
      balances: Object.entries(bal).map(([k, v]) => ({ typeId: k.split('|')[0], cycle: k.split('|')[1], days: v })),
      audit: aud.docs.map((d: any) => d.data() as any).sort((a: any, b: any) => String(b.at).localeCompare(String(a.at))).slice(0, 50)
        .map((a: any) => ({ action: a.action, by: a.actor, at: a.at })),
    });
  }
  // Payroll and salary history are deliberately not part of this view.
  return ok({ uid, name: emp.data.name, employments });
}

/** Returns null when the action is not a transfer action. */
export async function routeTransferAction(method: string, action: string, headers: Record<string, any>, body: any, deps: OrgDeps): Promise<OrgResult | null> {
  if (method === 'POST' && action === 'transfer-people') return transferPeople(headers, body, deps);
  if (method === 'POST' && action === 'transfer-propose') return proposeTransfer(headers, body);
  if (method === 'GET' && action === 'transfer-requests') return listProposals(headers);
  if (method === 'POST' && action === 'transfer-decide') return decideProposal(headers, body, deps);
  if (method === 'POST' && action === 'previous-employment') return previousEmployment(headers, body);
  return null;
}
