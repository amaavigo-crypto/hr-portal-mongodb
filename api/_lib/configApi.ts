/**
 * Configuration builders: custom fields on employee profiles and the report builder. /api/leave/config-<action>.
 *
 * Custom fields
 *   fields (GET)                      the fields I may see (all of them for custom.manage) and my own values
 *   save-fields (POST fields)         define the fields                                    custom.manage
 *   field-values (GET uid)            one person's values                                  custom.manage, or the person
 *   save-field-values (POST uid, values)   custom.manage for any field; the person only for fields marked self-edit
 * Reports
 *   report-datasets (GET)             the datasets I may report on, with their fields
 *   report-run (POST def | id, from?, to?)    run a definition                              the dataset's own permission
 *   reports (GET)  save-report (POST)  delete-report (POST)                                  report.manage (shared reports are listed to anyone who can run them)
 *
 *   customFieldDefs/{companyId}       the field definitions
 *   customFieldValues/{companyId__uid}  one person's values
 *   savedReports/{id}                 a saved definition
 *
 * Each dataset needs the permission that already guards that data: employees need report.manage, leave and attendance need
 * leave.report, assets asset.manage, payroll payroll.view. report.manage alone never opens salary or leave data.
 */
import { randomUUID } from 'node:crypto';
import { authErrorResponse } from './authContext.js';
import { companyRequests, loadPeople, loadProfiles } from './leaveCore.js';
import { cleanDefs, cleanValues, missingRequired, type FieldDef, type FieldValue } from '../../shared/customFields.js';
import { cleanDef, runReport, type CatalogField, type ReportDef } from '../../shared/reportBuilder.js';
import { sessionsOf, workedMinutesOf, istParts, daysBetween, addDays } from '../../shared/leaveEngine.js';
import { loadLines } from './payrollKit.js';
import { WorkError, dayOr, db, fail, guarded, need, needAny, nowIso, ok, peopleMap, str, whoIs, type Result, type WorkReq, type Who } from './workKit.js';

// ------------------------------------------------------------------ custom fields

async function loadDefs(cid: string): Promise<FieldDef[]> {
  const snap = await db().collection('customFieldDefs').doc(cid).get();
  return snap.exists ? ((snap.data() as any).defs as FieldDef[]) || [] : [];
}
async function loadValues(cid: string, uid: string): Promise<Record<string, FieldValue | null>> {
  const snap = await db().collection('customFieldValues').doc(`${cid}__${uid}`).get();
  return snap.exists ? ((snap.data() as any).values as any) || {} : {};
}

async function fields(who: Who): Promise<Result> {
  const manage = who.can('custom.manage');
  const defs = (await loadDefs(who.cid)).filter((d) => manage || d.selfView);
  return ok({ defs, values: await loadValues(who.cid, who.uid), canManage: manage });
}

async function saveFields(who: Who, body: any): Promise<Result> {
  need(who, 'custom.manage');
  const { defs, error } = cleanDefs(body?.fields);
  if (error) return fail(400, error);
  await db().collection('customFieldDefs').doc(who.cid).set({ companyId: who.cid, defs, updatedBy: who.uid, updatedAt: nowIso() });
  return ok({ defs });
}

async function fieldValues(who: Who, q: any): Promise<Result> {
  const uid = str(q.uid, 128) || who.uid;
  const manage = who.can('custom.manage');
  if (uid !== who.uid && !manage) throw new WorkError(403, 'You cannot view this person.');
  if (uid !== who.uid && !(await peopleMap(who.cid)).has(uid)) throw new WorkError(404, 'Employee not found.');
  const defs = (await loadDefs(who.cid)).filter((d) => manage || d.selfView);
  const stored = await loadValues(who.cid, uid);
  return ok({ uid, defs, values: Object.fromEntries(defs.map((d) => [d.key, stored[d.key] ?? null])), missing: manage ? missingRequired(defs, stored) : [] });
}

async function saveFieldValues(who: Who, body: any): Promise<Result> {
  const uid = str(body?.uid, 128) || who.uid;
  const manage = who.can('custom.manage');
  if (uid !== who.uid && !manage) throw new WorkError(403, 'You can only change your own details.');
  if (uid !== who.uid && !(await peopleMap(who.cid)).has(uid)) throw new WorkError(404, 'Employee not found.');
  const defs = await loadDefs(who.cid);
  const { values, error } = cleanValues(defs, body?.values, manage ? undefined : (d) => d.selfEdit);
  if (error) return fail(400, error);
  if (!manage) {
    const blocked = Object.keys(body?.values || {}).filter((k) => defs.some((d) => d.key === k && !d.selfEdit));
    if (blocked.length) return fail(403, 'Some of those fields can only be changed by HR.');
  }
  const stored = await loadValues(who.cid, uid);
  const merged: Record<string, FieldValue | null> = { ...stored, ...values };
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  await db().collection('customFieldValues').doc(`${who.cid}__${uid}`).set({ companyId: who.cid, uid, values: merged, updatedBy: who.uid, updatedAt: nowIso() });
  return ok({ values: merged });
}

// ------------------------------------------------------------------ reports

interface Dataset { key: string; label: string; perm: string[]; ranged: boolean; fields: (cid: string) => Promise<CatalogField[]>; rows: (who: Who, from: string, to: string) => Promise<Record<string, any>[]> }

const kindOf = (t: FieldDef['type']): CatalogField['kind'] => (t === 'NUMBER' ? 'number' : t === 'DATE' ? 'date' : t === 'BOOLEAN' ? 'bool' : 'text');
const F = (key: string, label: string, kind: CatalogField['kind'] = 'text'): CatalogField => ({ key, label, kind });
const MAX_RANGE = 93;
const monthsIn = (from: string, to: string) => { const out: string[] = []; for (let d = from.slice(0, 7); d <= to.slice(0, 7); d = addDays(`${d}-01`, 32).slice(0, 7)) out.push(d); return out; };

const DATASETS: Dataset[] = [
  {
    key: 'employees', label: 'Employees', perm: ['report.manage'], ranged: false,
    fields: async (cid) => [F('empId', 'Employee ID'), F('name', 'Name'), F('email', 'Email'), F('department', 'Department'), F('title', 'Job title'), F('active', 'Active', 'bool'), F('joinDate', 'Joining date', 'date'), F('manager', 'Manager'),
      ...(await loadDefs(cid)).map((d) => F(`cf_${d.key}`, d.label, kindOf(d.type)))],
    rows: async (who) => {
      const [people, profiles, defs, vals] = await Promise.all([loadPeople(who.cid), loadProfiles(who.cid), loadDefs(who.cid), db().collection('customFieldValues').where('companyId', '==', who.cid).get()]);
      const byUid = new Map(people.map((p) => [p.uid, p]));
      const values = new Map(vals.docs.map((d: any) => [(d.data() as any).uid, (d.data() as any).values || {}]));
      return people.filter((p) => !profiles.get(p.uid)?.hidden).map((p) => {
        const pr = profiles.get(p.uid);
        return { empId: p.empId, name: p.name, email: p.email, department: p.department, title: p.title, active: p.active, joinDate: pr?.joinDate || p.createdDate, manager: byUid.get(pr?.managerUid || '')?.name || '',
          ...Object.fromEntries(defs.map((d) => [`cf_${d.key}`, values.get(p.uid)?.[d.key] ?? null])) };
      });
    },
  },
  {
    key: 'leave', label: 'Leave requests', perm: ['leave.report', 'leave.manage'], ranged: true,
    fields: async () => [F('empId', 'Employee ID'), F('name', 'Name'), F('department', 'Department'), F('type', 'Leave type'), F('from', 'From', 'date'), F('to', 'To', 'date'), F('days', 'Days', 'number'), F('status', 'Status')],
    rows: async (who, from, to) => {
      const people = await peopleMap(who.cid);
      return (await companyRequests(who.cid)).filter((r) => r.to >= from && r.from <= to).map((r) => ({
        empId: people.get(r.uid)?.empId || '', name: r.name, department: people.get(r.uid)?.department || '', type: r.typeName, from: r.from, to: r.to, days: r.days, status: r.status,
      }));
    },
  },
  {
    key: 'attendance', label: 'Attendance', perm: ['leave.report', 'leave.manage'], ranged: true,
    fields: async () => [F('empId', 'Employee ID'), F('name', 'Name'), F('department', 'Department'), F('date', 'Date', 'date'), F('firstIn', 'First in'), F('lastOut', 'Last out'), F('hours', 'Hours worked', 'number'), F('punches', 'Punches', 'number'), F('source', 'Source')],
    rows: async (who, from, to) => {
      const people = await peopleMap(who.cid);
      const snaps = await Promise.all(monthsIn(from, to).map((m) => db().collection('leaveAttendance').where('companyId', '==', who.cid).where('month', '==', m).get()));
      return snaps.flatMap((s: any) => s.docs.map((d: any) => d.data())).filter((x: any) => x.date >= from && x.date <= to).map((x: any) => {
        const ss = sessionsOf(x), p = people.get(x.uid), last = ss[ss.length - 1];
        return { empId: p?.empId || '', name: p?.name || '', department: p?.department || '', date: x.date, firstIn: ss[0] ? istParts(ss[0].in).time : '', lastOut: last?.out ? istParts(last.out).time : '', hours: Math.round((workedMinutesOf(x) / 60) * 100) / 100, punches: ss.length * 2 - (last && !last.out ? 1 : 0), source: x.source || 'SELF' };
      });
    },
  },
  {
    key: 'assets', label: 'Assets', perm: ['asset.manage'], ranged: false,
    fields: async () => [F('tag', 'Tag'), F('name', 'Name'), F('category', 'Category'), F('status', 'Status'), F('assignedTo', 'Assigned to'), F('purchaseDate', 'Purchase date', 'date'), F('cost', 'Cost', 'number'), F('warrantyUntil', 'Warranty until', 'date'), F('serial', 'Serial no.')],
    rows: async (who) => (await db().collection('assets').where('companyId', '==', who.cid).get()).docs.map((d: any) => { const a = d.data(); return { tag: a.tag, name: a.name, category: a.category, status: a.status, assignedTo: a.assignedToName || '', purchaseDate: a.purchaseDate || '', cost: a.cost, warrantyUntil: a.warrantyUntil || '', serial: a.serial || '' }; }),
  },
  {
    key: 'payroll', label: 'Payroll (by month)', perm: ['payroll.view', 'payroll.manage'], ranged: true,
    fields: async () => [F('month', 'Month'), F('empId', 'Employee ID'), F('name', 'Name'), F('department', 'Department'), F('gross', 'Gross', 'number'), F('deductions', 'Deductions', 'number'), F('net', 'Net pay', 'number'), F('pf', 'Employee PF', 'number'), F('esic', 'Employee ESIC', 'number'), F('pt', 'Professional tax', 'number'), F('tds', 'Income tax (TDS)', 'number'), F('employerCost', 'Cost to company', 'number')],
    rows: async (who, from, to) => {
      const out: Record<string, any>[] = [];
      for (const month of monthsIn(from, to)) {
        const run = await db().collection('payrollRuns').doc(`${who.cid}__${month}`).get();
        if (!run.exists || (run.data() as any).status === 'DRAFT') continue;
        for (const l of await loadLines(who.cid, month)) out.push({ month, empId: l.employee.empId, name: l.employee.name, department: l.employee.department, gross: l.line.gross, deductions: l.line.totalDeductions, net: l.line.net, pf: l.line.statutory.pfEmployee, esic: l.line.statutory.esicEmployee, pt: l.line.statutory.pt, tds: l.line.tds || 0, employerCost: l.line.employerCost });
      }
      return out;
    },
  },
];

const datasetOf = (key: string) => DATASETS.find((d) => d.key === key);

async function datasets(who: Who): Promise<Result> {
  const items = [];
  for (const d of DATASETS) if (d.perm.some((p) => who.can(p))) items.push({ key: d.key, label: d.label, ranged: d.ranged, fields: await d.fields(who.cid) });
  return ok({ items, canBuild: who.can('report.manage') });
}

async function execute(who: Who, def: ReportDef, from: string, to: string): Promise<Result> {
  const ds = datasetOf(def.dataset);
  if (!ds) return fail(400, 'Choose a dataset.');
  needAny(who, ds.perm, `You do not have access to ${ds.label.toLowerCase()} data.`);
  const catalog = await ds.fields(who.cid);
  const { def: clean, error } = cleanDef(def, catalog);
  if (error || !clean) return fail(400, error || 'Invalid report.');
  let f = '', t = '';
  if (ds.ranged) {
    f = dayOr(from, 'From date'); t = dayOr(to, 'To date');
    if (f > t) return fail(400, 'The From date must be before the To date.');
    if (daysBetween(f, t) + 1 > MAX_RANGE) return fail(400, `Choose a range of at most ${MAX_RANGE} days.`);
  }
  return ok({ dataset: ds.key, ...runReport(clean, catalog, await ds.rows(who, f, t)) });
}

async function reportRun(who: Who, body: any): Promise<Result> {
  if (body?.id) {
    const snap = await db().collection('savedReports').doc(str(body.id, 80)).get();
    const r: any = snap.exists ? snap.data() : null;
    if (!r || r.companyId !== who.cid || (!r.shared && r.createdBy !== who.uid && !who.can('report.manage'))) return fail(404, 'Report not found.');
    return execute(who, r.def, body.from, body.to);
  }
  return execute(who, body?.def || {}, body?.from, body?.to);
}

async function reports(who: Who): Promise<Result> {
  const snap = await db().collection('savedReports').where('companyId', '==', who.cid).get();
  const mayRun = (k: string) => { const d = datasetOf(k); return !!d && d.perm.some((p) => who.can(p)); };
  const items = snap.docs.map((d: any) => d.data())
    .filter((r: any) => mayRun(r.def?.dataset) && (r.shared || r.createdBy === who.uid || who.can('report.manage')))
    .map((r: any) => ({ id: r.id, name: r.name, shared: !!r.shared, createdByName: r.createdByName, mine: r.createdBy === who.uid, def: r.def, updatedAt: r.updatedAt }))
    .sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return ok({ items });
}

async function saveReport(who: Who, body: any): Promise<Result> {
  need(who, 'report.manage');
  const name = str(body?.name, 80);
  if (!name) return fail(400, 'Name the report.');
  const ds = datasetOf(str(body?.def?.dataset, 30));
  if (!ds) return fail(400, 'Choose a dataset.');
  needAny(who, ds.perm, `You do not have access to ${ds.label.toLowerCase()} data.`);
  const { def, error } = cleanDef(body.def, await ds.fields(who.cid));
  if (error || !def) return fail(400, error || 'Invalid report.');
  const id = str(body?.id, 80) || randomUUID();
  const prev = await db().collection('savedReports').doc(id).get();
  const old: any = prev.exists ? prev.data() : null;
  if (old && (old.companyId !== who.cid || (old.createdBy !== who.uid && !who.admin))) return fail(404, 'Report not found.');
  await db().collection('savedReports').doc(id).set({ id, companyId: who.cid, name, def, shared: body?.shared === true, createdBy: old?.createdBy || who.uid, createdByName: old?.createdByName || who.name, createdAt: old?.createdAt || nowIso(), updatedAt: nowIso() });
  return ok({ id });
}

async function deleteReport(who: Who, body: any): Promise<Result> {
  need(who, 'report.manage');
  const ref = db().collection('savedReports').doc(str(body?.id, 80));
  const snap = await ref.get();
  const r: any = snap.exists ? snap.data() : null;
  if (!r || r.companyId !== who.cid || (r.createdBy !== who.uid && !who.admin)) return fail(404, 'Report not found.');
  await ref.delete();
  return ok({ deleted: true });
}

export async function routeConfig(r: WorkReq): Promise<Result> {
  const out = await guarded(async () => {
    const who = await whoIs(r.headers);
    const GET = r.method === 'GET', POST = r.method === 'POST';
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'fields': if (GET) return fields(who); break;
      case 'save-fields': if (POST) return saveFields(who, body); break;
      case 'field-values': if (GET) return fieldValues(who, r.query); break;
      case 'save-field-values': if (POST) return saveFieldValues(who, body); break;
      case 'report-datasets': if (GET) return datasets(who); break;
      case 'report-run': if (POST) return reportRun(who, body); break;
      case 'reports': if (GET) return reports(who); break;
      case 'save-report': if (POST) return saveReport(who, body); break;
      case 'delete-report': if (POST) return deleteReport(who, body); break;
      default: return fail(404, `Unknown config action '${r.action}'.`);
    }
    return fail(405, 'Method not allowed.');
  }, authErrorResponse);
  return out || fail(500, 'No result.');
}
