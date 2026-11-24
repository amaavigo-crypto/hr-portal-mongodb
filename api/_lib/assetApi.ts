/**
 * Company assets: /api/leave/assets-<action>.
 *
 *   mine (GET)              what is assigned to me                                  everyone
 *   acknowledge (POST id)   I confirm I received it                                 the assignee
 *   list (GET status? q?)   the register, with book value and warranty              asset.manage
 *   get (GET id)            one asset with its full history                         asset.manage (or the assignee)
 *   save (POST)             add or edit an asset                                    asset.manage
 *   import (POST rows)      add up to 500 assets at once                            asset.manage
 *   act (POST id, action)   assign | return | send_repair | repair_done | retire | lost | found
 *   pending (GET uid)       what a person still holds, for exit clearance            asset.manage
 *   summary (GET)           counts by status and category, total book value         asset.manage
 *
 *   assets/{id}             one asset; `history` keeps the last 200 events
 */
import { randomUUID } from 'node:crypto';
import { authErrorResponse } from './authContext.js';
import { inApp } from './leaveCore.js';
import { CONDITIONS, MAX_HISTORY, bookValue, transition, warrantyState, type AssetAction, type AssetStatus } from '../../shared/assets.js';
import { WorkError, dayOr, db, fail, guarded, need, nowIso, numIn, ok, peopleMap, str, todayIst, whoIs, type Result, type WorkReq, type Who } from './workKit.js';

const COL = 'assets';
const ACTIONS: AssetAction[] = ['assign', 'return', 'send_repair', 'repair_done', 'retire', 'lost', 'found'];

const view = (a: any, today: string, withHistory = false) => ({
  id: a.id, tag: a.tag, name: a.name, category: a.category, serial: a.serial, status: a.status, assignedTo: a.assignedTo || '', assignedToName: a.assignedToName || '', assignedAt: a.assignedAt || '',
  acknowledgedAt: a.acknowledgedAt || '', purchaseDate: a.purchaseDate, cost: a.cost, salvage: a.salvage || 0, usefulLifeMonths: a.usefulLifeMonths, warrantyUntil: a.warrantyUntil || '',
  warranty: warrantyState(a.warrantyUntil || '', today), bookValue: a.status === 'RETIRED' || a.status === 'LOST' ? 0 : bookValue(a, today), notes: a.notes || '', vendor: a.vendor || '',
  ...(withHistory ? { history: a.history || [] } : {}),
});

async function loadAll(cid: string): Promise<any[]> {
  const snap = await db().collection(COL).where('companyId', '==', cid).get();
  return snap.docs.map((d: any) => d.data());
}

async function loadOne(who: Who, id: string): Promise<any> {
  const snap = await db().collection(COL).doc(id).get();
  const a = snap.exists ? (snap.data() as any) : null;
  if (!a || a.companyId !== who.cid) throw new WorkError(404, 'Asset not found.');
  return a;
}

async function mine(who: Who): Promise<Result> {
  const today = todayIst();
  const items = (await loadAll(who.cid)).filter((a) => a.status === 'ASSIGNED' && a.assignedTo === who.uid).map((a) => view(a, today));
  return ok({ items });
}

async function acknowledge(who: Who, body: any): Promise<Result> {
  const id = str(body?.id, 80);
  await db().runTransaction(async (tx: any) => {
    const ref = db().collection(COL).doc(id);
    const snap = await tx.get(ref);
    const a: any = snap.exists ? snap.data() : null;
    if (!a || a.companyId !== who.cid || a.status !== 'ASSIGNED' || a.assignedTo !== who.uid) throw new WorkError(404, 'Asset not found.');
    if (a.acknowledgedAt) return;
    a.acknowledgedAt = nowIso();
    a.history = [...(a.history || []), { at: a.acknowledgedAt, action: 'ACKNOWLEDGED', by: who.name }].slice(-MAX_HISTORY);
    tx.set(ref, a);
  });
  return ok({ acknowledged: true });
}

async function list(who: Who, q: any): Promise<Result> {
  need(who, 'asset.manage');
  const today = todayIst();
  const status = str(q.status, 20), text = str(q.q, 80).toLowerCase();
  const items = (await loadAll(who.cid))
    .filter((a) => (!status || a.status === status) && (!text || [a.tag, a.name, a.serial, a.assignedToName, a.category].some((v) => String(v || '').toLowerCase().includes(text))))
    .sort((a, b) => String(a.tag).localeCompare(String(b.tag), undefined, { numeric: true }))
    .map((a) => view(a, today));
  return ok({ items });
}

async function get(who: Who, q: any): Promise<Result> {
  const a = await loadOne(who, str(q.id, 80));
  if (!who.can('asset.manage') && a.assignedTo !== who.uid) throw new WorkError(404, 'Asset not found.');
  return ok({ asset: view(a, todayIst(), true) });
}

function cleanAsset(body: any): { error?: string; data?: any } {
  const tag = str(body?.tag, 40).toUpperCase().replace(/[^A-Z0-9._/-]/g, '');
  const name = str(body?.name, 120);
  if (!tag) return { error: 'Give the asset a tag (for example LAP-0012).' };
  if (!name) return { error: 'Give the asset a name.' };
  try {
    return {
      data: {
        tag, name, category: str(body?.category, 60) || 'General', serial: str(body?.serial, 80), vendor: str(body?.vendor, 80), notes: str(body?.notes, 500),
        purchaseDate: dayOr(body?.purchaseDate, 'Purchase date', true), warrantyUntil: dayOr(body?.warrantyUntil, 'Warranty date', true),
        cost: numIn(body?.cost, 'Cost', 0, 1_000_000_000, 0), salvage: numIn(body?.salvage, 'Salvage value', 0, 1_000_000_000, 0), usefulLifeMonths: numIn(body?.usefulLifeMonths, 'Useful life (months)', 0, 600, 0),
      },
    };
  } catch (e: any) { return { error: e.message }; }
}

async function save(who: Who, body: any): Promise<Result> {
  need(who, 'asset.manage');
  const { data, error } = cleanAsset(body);
  if (error || !data) return fail(400, error || 'Invalid asset.');
  if (data.salvage > data.cost) return fail(400, 'Salvage value cannot be more than the cost.');
  const all = await loadAll(who.cid);
  const id = str(body?.id, 80);
  const existing = id ? all.find((a) => a.id === id) : undefined;
  if (id && !existing) return fail(404, 'Asset not found.');
  if (all.some((a) => a.tag === data.tag && a.id !== id)) return fail(409, `Tag ${data.tag} is already used.`);
  const now = nowIso();
  if (existing) {
    const doc = { ...existing, ...data, updatedAt: now, history: [...(existing.history || []), { at: now, action: 'EDITED', by: who.name }].slice(-MAX_HISTORY) };
    await db().collection(COL).doc(existing.id).set(doc);
    return ok({ id: existing.id });
  }
  const nid = randomUUID();
  await db().collection(COL).doc(nid).set({ id: nid, companyId: who.cid, ...data, status: 'IN_STOCK', assignedTo: '', assignedToName: '', createdAt: now, createdBy: who.uid, history: [{ at: now, action: 'ADDED', by: who.name }] });
  return ok({ id: nid });
}

async function importRows(who: Who, body: any): Promise<Result> {
  need(who, 'asset.manage');
  const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 500) : [];
  if (!rows.length) return fail(400, 'No rows to import.');
  const all = await loadAll(who.cid);
  const used = new Set(all.map((a) => a.tag));
  const problems: string[] = [];
  let added = 0;
  for (let i = 0; i < rows.length; i++) {
    const { data, error } = cleanAsset(rows[i]);
    if (error || !data) { problems.push(`Row ${i + 1}: ${error}`); continue; }
    if (data.salvage > data.cost) { problems.push(`Row ${i + 1}: salvage value is more than the cost.`); continue; }
    if (used.has(data.tag)) { problems.push(`Row ${i + 1}: tag ${data.tag} is already used.`); continue; }
    used.add(data.tag);
    const now = nowIso(), id = randomUUID();
    await db().collection(COL).doc(id).set({ id, companyId: who.cid, ...data, status: 'IN_STOCK', assignedTo: '', assignedToName: '', createdAt: now, createdBy: who.uid, history: [{ at: now, action: 'ADDED', by: who.name, via: 'import' }] });
    added++;
  }
  return ok({ added, problems: problems.slice(0, 50) });
}

async function act(who: Who, body: any): Promise<Result> {
  need(who, 'asset.manage');
  const action = str(body?.action, 20) as AssetAction;
  if (!ACTIONS.includes(action)) return fail(400, 'Unknown action.');
  const note = str(body?.note, 300);
  const condition = str(body?.condition, 10).toUpperCase();
  let notify: { uid: string; text: string } | null = null;
  let assigneeName = '';
  if (action === 'assign') {
    const p = (await peopleMap(who.cid)).get(str(body?.uid, 128));
    if (!p || !p.active) return fail(400, 'Choose an active employee to assign this to.');
    assigneeName = p.name;
  }
  if (action === 'return' && condition && !(CONDITIONS as readonly string[]).includes(condition)) return fail(400, 'Condition must be GOOD, FAIR or DAMAGED.');
  const id = str(body?.id, 80);
  await db().collection(COL).doc(id).get().then((s: any) => { if (!s.exists || (s.data() as any).companyId !== who.cid) throw new WorkError(404, 'Asset not found.'); });
  await db().runTransaction(async (tx: any) => {
    const ref = db().collection(COL).doc(id);
    const snap = await tx.get(ref);
    const a: any = snap.data();
    const t = transition(a.status as AssetStatus, action);
    if (t.ok === false) throw new WorkError(409, t.error);
    const now = nowIso();
    const event: any = { at: now, action: action.toUpperCase(), by: who.name, ...(note ? { note } : {}) };
    if (action === 'assign') {
      a.assignedTo = str(body?.uid, 128); a.assignedToName = assigneeName; a.assignedAt = now; a.acknowledgedAt = '';
      event.to = assigneeName; notify = { uid: a.assignedTo, text: `${a.name} (${a.tag}) has been assigned to you. Please confirm you received it.` };
    }
    if (action === 'return') { event.from = a.assignedToName; event.condition = condition || 'GOOD'; a.assignedTo = ''; a.assignedToName = ''; a.assignedAt = ''; a.acknowledgedAt = ''; }
    if (action === 'send_repair' && a.status === 'ASSIGNED') { event.from = a.assignedToName; a.assignedTo = ''; a.assignedToName = ''; a.assignedAt = ''; a.acknowledgedAt = ''; }
    if (action === 'lost' && a.status === 'ASSIGNED') { event.from = a.assignedToName; a.assignedTo = ''; a.assignedToName = ''; a.assignedAt = ''; a.acknowledgedAt = ''; }
    a.status = t.to;
    a.history = [...(a.history || []), event].slice(-MAX_HISTORY);
    a.updatedAt = now;
    tx.set(ref, a);
  });
  const n = notify as { uid: string; text: string } | null;
  if (n) await inApp(who.cid, [n.uid], 'Asset assigned', n.text, '', `asset-${id}-${Date.now()}`);
  return ok({ done: true });
}

async function pending(who: Who, q: any): Promise<Result> {
  need(who, 'asset.manage');
  const uid = str(q.uid, 128);
  if (!uid) return fail(400, 'Choose a person.');
  const today = todayIst();
  const items = (await loadAll(who.cid)).filter((a) => a.status === 'ASSIGNED' && a.assignedTo === uid).map((a) => view(a, today));
  return ok({ uid, items, clear: items.length === 0 });
}

async function summary(who: Who): Promise<Result> {
  need(who, 'asset.manage');
  const today = todayIst();
  const all = (await loadAll(who.cid)).map((a) => view(a, today));
  const byStatus: Record<string, number> = {}, byCategory: Record<string, { count: number; bookValue: number }> = {};
  for (const a of all) {
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    const c = (byCategory[a.category] = byCategory[a.category] || { count: 0, bookValue: 0 });
    c.count++; c.bookValue = Math.round((c.bookValue + a.bookValue) * 100) / 100;
  }
  return ok({
    total: all.length, byStatus, byCategory, bookValue: Math.round(all.reduce((n, a) => n + a.bookValue, 0) * 100) / 100,
    warrantyExpiring: all.filter((a) => a.warranty === 'EXPIRING' && a.status !== 'RETIRED').length, unacknowledged: all.filter((a) => a.status === 'ASSIGNED' && !a.acknowledgedAt).length,
  });
}

export async function routeAssets(r: WorkReq): Promise<Result> {
  const out = await guarded(async () => {
    const who = await whoIs(r.headers);
    const GET = r.method === 'GET', POST = r.method === 'POST';
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'mine': if (GET) return mine(who); break;
      case 'acknowledge': if (POST) return acknowledge(who, body); break;
      case 'list': if (GET) return list(who, r.query); break;
      case 'get': if (GET) return get(who, r.query); break;
      case 'save': if (POST) return save(who, body); break;
      case 'import': if (POST) return importRows(who, body); break;
      case 'act': if (POST) return act(who, body); break;
      case 'pending': if (GET) return pending(who, r.query); break;
      case 'summary': if (GET) return summary(who); break;
      default: return fail(404, `Unknown assets action '${r.action}'.`);
    }
    return fail(405, 'Method not allowed.');
  }, authErrorResponse);
  return out || fail(500, 'No result.');
}
