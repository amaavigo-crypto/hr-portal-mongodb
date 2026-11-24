/**
 * Professional services: clients, projects, allocation, timesheets with approval, billing. /api/leave/psa-<action>.
 *
 *   clients / save-client                      psa.view to read, psa.manage to change
 *   projects / save-project                    managers see all; everyone else sees projects they are allocated to
 *   allocations (GET projectId?) / save-allocation / delete-allocation / load (GET weekStart: planned hours per person)
 *   my-projects (GET)                          the projects I can log time on
 *   sheet (GET weekStart, uid?)                a week of time (mine, or someone's for psa.manage / their manager)
 *   save-sheet (POST weekStart, entries)       draft or rejected weeks only
 *   submit-sheet (POST weekStart)              sends it to my reporting manager (or a psa.manage person when I have none)
 *   queue (GET)  /  decide-sheet (POST id, approve, note)
 *   billable (GET clientId, from, to)          what is ready to invoice
 *   create-invoice (POST) / invoices / invoice (GET id) / invoice-status (POST id, status)
 *   utilisation (GET from, to)                 billable against other hours per person
 *
 *   psaClients  psaProjects  psaAllocations  psaTimesheets  psaInvoices
 * Approved time is billed once: the invoice stamps each sheet with the project it covered, and voiding the invoice releases it.
 */
import { randomUUID } from 'node:crypto';
import { authErrorResponse } from './authContext.js';
import { inApp, loadProfiles } from './leaveCore.js';
import { BILLING, billableLines, cleanEntries, isDay, loggedHours, plannedLoad, round2, totals, weekStart, type Entry, type ProjectLite, type SheetLite } from '../../shared/psa.js';
import { WorkError, dayOr, db, fail, guarded, need, needAny, nowIso, numIn, ok, peopleMap, str, todayIst, whoIs, type Result, type WorkReq, type Who } from './workKit.js';

const CL = 'psaClients', PR = 'psaProjects', AL = 'psaAllocations', TS = 'psaTimesheets', IV = 'psaInvoices';
const rows = async (col: string, cid: string): Promise<any[]> => (await db().collection(col).where('companyId', '==', cid).get()).docs.map((d: any) => d.data());
const canSee = (w: Who) => w.can('psa.manage') || w.can('psa.view');
const mondayOf = (v: unknown) => { const d = dayOr(v, 'Week'); return weekStart(d); };
const sheetId = (cid: string, uid: string, ws: string) => `${cid}__${uid}__${ws}`;

async function myProjectIds(who: Who): Promise<Set<string>> {
  const live = new Set((await rows(PR, who.cid)).filter((p) => p.status === 'ACTIVE').map((p) => p.id));
  return new Set((await rows(AL, who.cid)).filter((a) => a.uid === who.uid && live.has(a.projectId)).map((a) => a.projectId));
}

// ---- clients and projects
async function clients(who: Who): Promise<Result> { needAny(who, ['psa.view', 'psa.manage']); return ok({ items: (await rows(CL, who.cid)).sort((a, b) => a.name.localeCompare(b.name)) }); }

async function saveClient(who: Who, b: any): Promise<Result> {
  need(who, 'psa.manage');
  const name = str(b.name, 120); if (!name) return fail(400, 'Client name is needed.');
  const id = str(b.id, 80) || randomUUID(), prev = await db().collection(CL).doc(id).get();
  if (prev.exists && (prev.data() as any).companyId !== who.cid) return fail(404, 'Client not found.');
  await db().collection(CL).doc(id).set({ id, companyId: who.cid, name, contactName: str(b.contactName, 120), email: str(b.email, 160), address: str(b.address, 400), gstin: str(b.gstin, 20).toUpperCase(), active: b.active !== false, createdAt: prev.exists ? (prev.data() as any).createdAt : nowIso(), updatedAt: nowIso() });
  return ok({ id });
}

async function projects(who: Who): Promise<Result> {
  const all = await rows(PR, who.cid), cl = new Map((await rows(CL, who.cid)).map((c) => [c.id, c.name]));
  const mine = canSee(who) ? null : await myProjectIds(who);
  const logged = new Map<string, number>();
  if (canSee(who)) for (const s of await rows(TS, who.cid)) if (['SUBMITTED', 'APPROVED'].includes(s.status)) for (const e of s.entries || []) logged.set(e.projectId, (logged.get(e.projectId) || 0) + e.hours);
  const items = all.filter((p) => !mine || mine.has(p.id)).map((p) => (canSee(who) ? { ...p, clientName: cl.get(p.clientId) || '', loggedHours: round2(logged.get(p.id) || 0) } : { id: p.id, name: p.name, code: p.code, clientName: cl.get(p.clientId) || '', billable: p.billable, status: p.status }));
  return ok({ items: items.sort((a: any, b: any) => a.name.localeCompare(b.name)) });
}

async function saveProject(who: Who, b: any): Promise<Result> {
  need(who, 'psa.manage');
  const name = str(b.name, 120); if (!name) return fail(400, 'Project name is needed.');
  const client = await db().collection(CL).doc(str(b.clientId, 80)).get();
  if (!client.exists || (client.data() as any).companyId !== who.cid) return fail(400, 'Choose a client.');
  const billing = BILLING.includes(b.billing) ? b.billing : 'TM';
  const roleRates: Record<string, number> = {};
  for (const [u, r] of Object.entries(b.roleRates && typeof b.roleRates === 'object' ? b.roleRates : {})) { const n = Number(r); if (Number.isFinite(n) && n >= 0 && n <= 1e7) roleRates[u.slice(0, 80)] = n; }
  const id = str(b.id, 80) || randomUUID(), prev = await db().collection(PR).doc(id).get();
  if (prev.exists && (prev.data() as any).companyId !== who.cid) return fail(404, 'Project not found.');
  const old: any = prev.exists ? prev.data() : {};
  const fixedFee = billing === 'FIXED' ? numIn(b.fixedFee, 'Fixed fee', 0, 1e9, 0) : 0;
  if (billing === 'FIXED' && fixedFee < (old.fixedBilled || 0)) return fail(400, 'The fixed fee cannot be lower than what is already billed.');
  await db().collection(PR).doc(id).set({
    id, companyId: who.cid, clientId: client.id, name, code: str(b.code, 20).toUpperCase(), billing, billable: b.billable !== false, defaultRate: numIn(b.defaultRate, 'Rate', 0, 1e7, 0), roleRates,
    fixedFee, fixedBilled: old.fixedBilled || 0, budgetHours: numIn(b.budgetHours, 'Budget hours', 0, 1e6, 0), managerUid: str(b.managerUid, 80), status: b.status === 'CLOSED' ? 'CLOSED' : 'ACTIVE',
    startDate: isDay(b.startDate) ? b.startDate : '', endDate: isDay(b.endDate) ? b.endDate : '', createdAt: old.createdAt || nowIso(), updatedAt: nowIso(),
  });
  return ok({ id });
}

// ---- allocation
async function allocations(who: Who, q: any): Promise<Result> {
  needAny(who, ['psa.view', 'psa.manage']);
  const people = await peopleMap(who.cid), pr = new Map((await rows(PR, who.cid)).map((p) => [p.id, p.name]));
  const pid = str(q.projectId, 80);
  return ok({ items: (await rows(AL, who.cid)).filter((a) => !pid || a.projectId === pid).map((a) => ({ ...a, name: people.get(a.uid)?.name || '', projectName: pr.get(a.projectId) || '' })).sort((a, b) => a.name.localeCompare(b.name) || a.from.localeCompare(b.from)) });
}

async function saveAllocation(who: Who, b: any): Promise<Result> {
  need(who, 'psa.manage');
  const people = await peopleMap(who.cid), pj = await db().collection(PR).doc(str(b.projectId, 80)).get();
  if (!pj.exists || (pj.data() as any).companyId !== who.cid) return fail(400, 'Choose a project.');
  if (!people.get(str(b.uid, 80))?.active) return fail(400, 'Choose an active employee.');
  const from = dayOr(b.from, 'Start'), to = dayOr(b.to, 'End'); if (to < from) return fail(400, 'The end is before the start.');
  const hoursPerWeek = numIn(b.hoursPerWeek, 'Hours per week', 0.25, 80);
  const id = str(b.id, 80) || randomUUID(), prev = await db().collection(AL).doc(id).get();
  if (prev.exists && (prev.data() as any).companyId !== who.cid) return fail(404, 'Allocation not found.');
  await db().collection(AL).doc(id).set({ id, companyId: who.cid, projectId: pj.id, uid: b.uid, hoursPerWeek, from, to, createdBy: who.uid, createdAt: prev.exists ? (prev.data() as any).createdAt : nowIso() });
  return ok({ id });
}

async function deleteAllocation(who: Who, b: any): Promise<Result> {
  need(who, 'psa.manage');
  const ref = db().collection(AL).doc(str(b.id, 80)), s = await ref.get();
  if (!s.exists || (s.data() as any).companyId !== who.cid) return fail(404, 'Allocation not found.');
  await ref.delete(); return ok();
}

async function load(who: Who, q: any): Promise<Result> {
  needAny(who, ['psa.view', 'psa.manage']);
  const ws = mondayOf(q.weekStart || todayIst()), people = await peopleMap(who.cid);
  const cap = numIn(q.capacity, 'Capacity', 1, 80, 40);
  return ok({ weekStart: ws, items: plannedLoad(await rows(AL, who.cid), ws, cap).map((r) => ({ ...r, name: people.get(r.uid)?.name || '' })) });
}

// ---- timesheets
const myProjects = async (who: Who): Promise<Result> => {
  const ids = await myProjectIds(who), cl = new Map((await rows(CL, who.cid)).map((c) => [c.id, c.name]));
  return ok({ items: (await rows(PR, who.cid)).filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, name: p.name, code: p.code, clientName: cl.get(p.clientId) || '', billable: p.billable })) });
};

async function managerOk(who: Who, uid: string): Promise<boolean> {
  if (who.can('psa.manage')) return true;
  return (await loadProfiles(who.cid)).get(uid)?.managerUid === who.uid;
}

async function sheet(who: Who, q: any): Promise<Result> {
  const ws = mondayOf(q.weekStart || todayIst()), uid = str(q.uid, 80) || who.uid;
  if (uid !== who.uid && !(await managerOk(who, uid))) return fail(403, 'You do not have access to this.');
  const s = (await db().collection(TS).doc(sheetId(who.cid, uid, ws)).get()).data() as any;
  return ok({ weekStart: ws, sheet: s || { uid, weekStart: ws, status: 'DRAFT', entries: [] } });
}

async function saveSheet(who: Who, b: any): Promise<Result> {
  const ws = mondayOf(b.weekStart), id = sheetId(who.cid, who.uid, ws), cur = (await db().collection(TS).doc(id).get()).data() as any;
  if (cur && !['DRAFT', 'REJECTED'].includes(cur.status)) return fail(409, `This week is ${cur.status.toLowerCase()} and can no longer be edited.`);
  const { entries, error } = cleanEntries(ws, b.entries, await myProjectIds(who));
  if (error || !entries) return fail(400, error || 'Invalid entries.');
  await db().collection(TS).doc(id).set({ id, companyId: who.cid, uid: who.uid, name: who.name, weekStart: ws, status: 'DRAFT', entries, invoiced: {}, updatedAt: nowIso() });
  return ok({ id });
}

async function submitSheet(who: Who, b: any): Promise<Result> {
  const ws = mondayOf(b.weekStart), ref = db().collection(TS).doc(sheetId(who.cid, who.uid, ws)), cur = (await ref.get()).data() as any;
  if (!cur || !cur.entries?.length) return fail(400, 'Add some time before sending the week.');
  if (!['DRAFT', 'REJECTED'].includes(cur.status)) return fail(409, 'This week was already sent.');
  const people = await peopleMap(who.cid), mgr = (await loadProfiles(who.cid)).get(who.uid)?.managerUid || '';
  const to = mgr && people.get(mgr)?.active ? [mgr] : []; // with no manager, people with psa.manage see it in their queue
  await ref.set({ ...cur, status: 'SUBMITTED', submittedAt: nowIso(), decisionNote: '' });
  if (to.length) await inApp(who.cid, to, 'Timesheet to approve', `${who.name}: week of ${ws}`, '', `psa-${cur.id}-${Date.now()}`);
  return ok();
}

async function queue(who: Who): Promise<Result> {
  const profiles = await loadProfiles(who.cid), all = who.can('psa.manage');
  const items = (await rows(TS, who.cid)).filter((s) => s.status === 'SUBMITTED' && s.uid !== who.uid && (all || profiles.get(s.uid)?.managerUid === who.uid));
  const pr = new Map((await rows(PR, who.cid)).map((p) => [p.id, p.name]));
  return ok({ items: items.map((s) => ({ id: s.id, uid: s.uid, name: s.name, weekStart: s.weekStart, hours: round2(s.entries.reduce((a: number, e: Entry) => a + e.hours, 0)), byProject: Object.entries(s.entries.reduce((m: any, e: Entry) => ({ ...m, [pr.get(e.projectId) || '?']: round2((m[pr.get(e.projectId) || '?'] || 0) + e.hours) }), {})).map(([project, hours]) => ({ project, hours })) })).sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.name.localeCompare(b.name)) });
}

async function decideSheet(who: Who, b: any): Promise<Result> {
  const ref = db().collection(TS).doc(str(b.id, 160)), s = (await ref.get()).data() as any;
  if (!s || s.companyId !== who.cid) return fail(404, 'Timesheet not found.');
  if (s.uid === who.uid) return fail(403, 'You cannot decide on your own timesheet.');
  if (!(await managerOk(who, s.uid))) return fail(403, 'You do not have access to this.');
  if (s.status !== 'SUBMITTED') return fail(409, 'This timesheet is not waiting for a decision.');
  const approve = b.approve === true, note = str(b.note, 400);
  if (!approve && !note) return fail(400, 'Say why you are sending it back.');
  await ref.set({ ...s, status: approve ? 'APPROVED' : 'REJECTED', decidedBy: who.uid, decidedByName: who.name, decidedAt: nowIso(), decisionNote: note });
  await inApp(who.cid, [s.uid], approve ? 'Timesheet approved' : 'Timesheet sent back', `Week of ${s.weekStart}${note ? `: ${note}` : ''}`, '', `psa-${s.id}-${Date.now()}`);
  return ok();
}

// ---- billing
const lite = (p: any): ProjectLite => ({ id: p.id, clientId: p.clientId, name: p.name, billing: p.billing, billable: p.billable, defaultRate: p.defaultRate || 0, roleRates: p.roleRates || {}, fixedFee: p.fixedFee || 0, fixedBilled: p.fixedBilled || 0 });

function range(q: any): { from: string; to: string } {
  const from = dayOr(q.from, 'From'), to = dayOr(q.to, 'To'); if (to < from) throw new WorkError(400, 'The end is before the start.');
  if (Date.parse(to) - Date.parse(from) > 400 * 86400_000) throw new WorkError(400, 'Choose a range of up to 400 days.');
  return { from, to };
}

async function billable(who: Who, q: any): Promise<Result> {
  need(who, 'psa.manage');
  const { from, to } = range(q), clientId = str(q.clientId, 80), pr = (await rows(PR, who.cid)).map(lite);
  const lines = billableLines(await rows(TS, who.cid), pr, clientId, weekStart(from), to);
  return ok({ lines, subtotal: totals(lines, 0).subtotal, fixed: pr.filter((p) => p.clientId === clientId && p.billing === 'FIXED' && p.billable).map((p) => ({ projectId: p.id, name: p.name, fixedFee: p.fixedFee, billed: p.fixedBilled, remaining: round2((p.fixedFee || 0) - (p.fixedBilled || 0)) })) });
}

async function createInvoice(who: Who, b: any): Promise<Result> {
  need(who, 'psa.manage');
  const { from, to } = range(b), clientId = str(b.clientId, 80), taxPct = numIn(b.taxPct, 'Tax %', 0, 100, 0);
  const client = (await db().collection(CL).doc(clientId).get()).data() as any;
  if (!client || client.companyId !== who.cid) return fail(400, 'Choose a client.');
  const projectsAll = (await rows(PR, who.cid)), pr = projectsAll.map(lite);
  const sheets = await rows(TS, who.cid);
  const lines: any[] = billableLines(sheets, pr, clientId, weekStart(from), to);
  const fixed: { projectId: string; amount: number }[] = [];
  for (const f of Array.isArray(b.fixed) ? b.fixed : []) {
    const p = pr.find((x) => x.id === f?.projectId && x.clientId === clientId && x.billing === 'FIXED' && x.billable), amt = Number(f?.amount);
    if (!p) return fail(400, 'A fixed-fee project in the request does not belong to this client.');
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (amt > (p.fixedFee || 0) - (p.fixedBilled || 0) + 0.005) return fail(400, `${p.name}: more than the fee still to bill.`);
    lines.push({ projectId: p.id, projectName: p.name, uid: '', name: 'Fixed fee', hours: 0, rate: 0, amount: round2(amt), sheetIds: [] }); fixed.push({ projectId: p.id, amount: round2(amt) });
  }
  if (!lines.length) return fail(400, 'Nothing to bill for this client in this period.');
  const year = todayIst().slice(0, 4), existing = (await rows(IV, who.cid)).map((i) => i.number as string).filter((n) => n.startsWith(`INV-${year}-`)).map((n) => Number(n.split('-')[2]) || 0);
  const number = `INV-${year}-${String(Math.max(0, ...existing) + 1).padStart(4, '0')}`, id = randomUUID(), t = totals(lines, taxPct);
  const issueDate = todayIst(), dueDate = new Date(Date.parse(issueDate) + numIn(b.dueDays, 'Due days', 0, 365, 30) * 86400_000).toISOString().slice(0, 10);
  await db().runTransaction(async (tx: any) => {
    for (const l of lines) for (const sid of l.sheetIds) {
      const ref = db().collection(TS).doc(sid), s = (await tx.get(ref)).data() as any;
      if (!s || s.invoiced?.[l.projectId]) throw new WorkError(409, 'Some of this time was just billed on another invoice. Try again.');
      tx.set(ref, { ...s, invoiced: { ...(s.invoiced || {}), [l.projectId]: id } });
    }
    for (const f of fixed) { const ref = db().collection(PR).doc(f.projectId), p = (await tx.get(ref)).data() as any; tx.set(ref, { ...p, fixedBilled: round2((p.fixedBilled || 0) + f.amount) }); }
    tx.set(db().collection(IV).doc(id), { id, companyId: who.cid, number, clientId, clientName: client.name, from, to, lines, taxPct, ...t, status: 'DRAFT', issueDate, dueDate, notes: str(b.notes, 500), createdBy: who.uid, createdAt: nowIso() });
  });
  return ok({ id, number, ...t });
}

async function invoices(who: Who): Promise<Result> {
  needAny(who, ['psa.view', 'psa.manage']);
  return ok({ items: (await rows(IV, who.cid)).map(({ lines, ...rest }) => ({ ...rest, lineCount: (lines || []).length })).sort((a, b) => b.number.localeCompare(a.number)) });
}

async function invoice(who: Who, q: any): Promise<Result> {
  needAny(who, ['psa.view', 'psa.manage']);
  const i = (await db().collection(IV).doc(str(q.id, 80)).get()).data() as any;
  return !i || i.companyId !== who.cid ? fail(404, 'Invoice not found.') : ok({ invoice: i });
}

const NEXT: Record<string, string[]> = { DRAFT: ['SENT', 'VOID'], SENT: ['PAID', 'VOID'], PAID: [], VOID: [] };
async function invoiceStatus(who: Who, b: any): Promise<Result> {
  need(who, 'psa.manage');
  const status = str(b.status, 10), ref = db().collection(IV).doc(str(b.id, 80)), i = (await ref.get()).data() as any;
  if (!i || i.companyId !== who.cid) return fail(404, 'Invoice not found.');
  if (!NEXT[i.status]?.includes(status)) return fail(409, `A ${i.status.toLowerCase()} invoice cannot become ${status.toLowerCase() || 'that'}.`);
  await db().runTransaction(async (tx: any) => {
    if (status === 'VOID') {
      for (const l of i.lines) {
        for (const sid of l.sheetIds || []) { const r = db().collection(TS).doc(sid), s = (await tx.get(r)).data() as any; if (s?.invoiced?.[l.projectId] === i.id) { const inv = { ...s.invoiced }; delete inv[l.projectId]; tx.set(r, { ...s, invoiced: inv }); } }
        if (!l.sheetIds?.length && l.projectId && l.name === 'Fixed fee') { const r = db().collection(PR).doc(l.projectId), p = (await tx.get(r)).data() as any; if (p) tx.set(r, { ...p, fixedBilled: Math.max(0, round2((p.fixedBilled || 0) - l.amount)) }); }
      }
    }
    tx.set(ref, { ...i, status, ...(status === 'PAID' ? { paidAt: nowIso() } : {}) });
  });
  return ok();
}

async function utilisation(who: Who, q: any): Promise<Result> {
  needAny(who, ['psa.view', 'psa.manage']);
  const { from, to } = range(q), pr = (await rows(PR, who.cid)).map(lite);
  const sheets = (await rows(TS, who.cid)).filter((s) => s.weekStart >= weekStart(from) && s.weekStart <= to);
  return ok({ items: loggedHours(sheets, pr) });
}

export async function routePsa(r: WorkReq): Promise<Result> {
  const out = await guarded(async () => {
    const who = await whoIs(r.headers), GET = r.method === 'GET', POST = r.method === 'POST';
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'clients': if (GET) return clients(who); break;
      case 'save-client': if (POST) return saveClient(who, body); break;
      case 'projects': if (GET) return projects(who); break;
      case 'save-project': if (POST) return saveProject(who, body); break;
      case 'allocations': if (GET) return allocations(who, r.query); break;
      case 'save-allocation': if (POST) return saveAllocation(who, body); break;
      case 'delete-allocation': if (POST) return deleteAllocation(who, body); break;
      case 'load': if (GET) return load(who, r.query); break;
      case 'my-projects': if (GET) return myProjects(who); break;
      case 'sheet': if (GET) return sheet(who, r.query); break;
      case 'save-sheet': if (POST) return saveSheet(who, body); break;
      case 'submit-sheet': if (POST) return submitSheet(who, body); break;
      case 'queue': if (GET) return queue(who); break;
      case 'decide-sheet': if (POST) return decideSheet(who, body); break;
      case 'billable': if (GET) return billable(who, r.query); break;
      case 'create-invoice': if (POST) return createInvoice(who, body); break;
      case 'invoices': if (GET) return invoices(who); break;
      case 'invoice': if (GET) return invoice(who, r.query); break;
      case 'invoice-status': if (POST) return invoiceStatus(who, body); break;
      case 'utilisation': if (GET) return utilisation(who, r.query); break;
      default: return fail(404, `Unknown psa action '${r.action}'.`);
    }
    return fail(405, 'Method not allowed.');
  }, authErrorResponse);
  return out || fail(500, 'No result.');
}
