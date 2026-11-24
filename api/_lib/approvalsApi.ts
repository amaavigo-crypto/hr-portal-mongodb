/**
 * Approval chains for any kind of request: /api/leave/approvals-<action>.
 *
 *   kinds (GET)                    the kinds of request that have an active chain (for the "new request" form)
 *   chains (GET)                   every chain                                          workflow.manage
 *   save-chain / delete-chain      (POST)                                               workflow.manage
 *   submit (POST kind, title, details, amount)   starts a request on the matching chain
 *   mine (GET)                     requests I made
 *   inbox (GET)                    requests waiting for my decision
 *   get (GET id)                   one request with its steps and history                the requester, an approver, or workflow.manage
 *   decide (POST id, approve, note)   an approver of the current step
 *   cancel (POST id)               the requester, while it is pending
 *
 *   approvalChains/{id}   approvalRequests/{id}
 * The chain is copied into the request when it is sent (who approves each step is fixed then), so editing a chain later never
 * changes a request already in flight.
 */
import { randomUUID } from 'node:crypto';
import { authErrorResponse } from './authContext.js';
import { inApp, loadProfiles } from './leaveCore.js';
import { canDecide, cleanChain, decide as applyDecision, matchChain, resolveSteps, type ChainDef } from '../../shared/approvalChain.js';
import { WorkError, db, fail, guarded, need, nowIso, numIn, ok, peopleMap, str, whoIs, type Result, type WorkReq, type Who } from './workKit.js';

const CH = 'approvalChains', RQ = 'approvalRequests';

async function allChains(cid: string): Promise<ChainDef[]> {
  return (await db().collection(CH).where('companyId', '==', cid).get()).docs.map((d: any) => d.data() as ChainDef);
}

async function kinds(who: Who): Promise<Result> {
  const chains = (await allChains(who.cid)).filter((c) => c.active);
  return ok({ items: Array.from(new Set(chains.map((c) => c.kind))).sort().map((k) => ({ kind: k, minAmount: Math.min(...chains.filter((c) => c.kind === k).map((c) => c.minAmount)) })) });
}

async function chains(who: Who): Promise<Result> {
  need(who, 'workflow.manage');
  return ok({ items: (await allChains(who.cid)).sort((a, b) => a.kind.localeCompare(b.kind) || a.minAmount - b.minAmount) });
}

async function saveChain(who: Who, body: any): Promise<Result> {
  need(who, 'workflow.manage');
  const { chain, error } = cleanChain(body);
  if (error || !chain) return fail(400, error || 'Invalid chain.');
  const people = await peopleMap(who.cid);
  const named = [...chain.fallbackUids, ...chain.steps.flatMap((s) => s.uids || [])];
  if (named.some((u) => !people.get(u)?.active)) return fail(400, 'One of the approvers is not an active employee of this company.');
  const id = str(body?.id, 80) || randomUUID();
  const all = await allChains(who.cid);
  if (all.some((c) => c.id !== id && c.kind === chain.kind && c.minAmount === chain.minAmount && c.active && chain.active)) return fail(409, 'Another active chain already covers this kind from the same amount.');
  const prev = await db().collection(CH).doc(id).get();
  if (prev.exists && (prev.data() as any).companyId !== who.cid) return fail(404, 'Chain not found.');
  await db().collection(CH).doc(id).set({ id, companyId: who.cid, ...chain, updatedAt: nowIso(), updatedBy: who.uid });
  return ok({ id });
}

async function deleteChain(who: Who, body: any): Promise<Result> {
  need(who, 'workflow.manage');
  const ref = db().collection(CH).doc(str(body?.id, 80));
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as any).companyId !== who.cid) return fail(404, 'Chain not found.');
  await ref.delete();
  return ok({ deleted: true });
}

const row = (r: any) => ({ id: r.id, kind: r.kind, title: r.title, amount: r.amount, status: r.status, requesterName: r.requesterName, createdAt: r.createdAt, current: r.current, steps: r.steps.map((s: any) => ({ name: s.name, status: s.status, approvedBy: s.approvedBy.length, of: s.approverUids.length })) });

async function submit(who: Who, body: any): Promise<Result> {
  const kind = str(body?.kind, 40).toLowerCase();
  const title = str(body?.title, 160);
  if (!title) return fail(400, 'Give the request a title.');
  const amount = numIn(body?.amount, 'Amount', 0, 1e12, 0);
  const chain = matchChain(await allChains(who.cid), kind, amount);
  if (!chain) return fail(400, 'There is no approval chain set up for this kind of request. Ask an administrator.');
  const [people, profiles] = await Promise.all([peopleMap(who.cid), loadProfiles(who.cid)]);
  const { steps, error } = resolveSteps(chain, who.uid, { managerOf: (u) => profiles.get(u)?.managerUid || '', isActive: (u) => !!people.get(u)?.active });
  if (error || !steps) return fail(409, error || 'Could not work out who approves this.');
  const id = randomUUID(), now = nowIso();
  const doc = {
    id, companyId: who.cid, chainId: chain.id, chainName: chain.name, kind, title, details: str(body?.details, 2000), amount, requesterUid: who.uid, requesterName: who.name, status: 'PENDING', current: 0, steps,
    history: [{ at: now, action: 'SUBMITTED', uid: who.uid, name: who.name }], createdAt: now,
  };
  await db().collection(RQ).doc(id).set(doc);
  await inApp(who.cid, steps[0].approverUids, 'Approval needed', `${who.name}: ${title}`, '', `approval-${id}-0`);
  return ok({ id, steps: steps.map((s) => ({ name: s.name, approvers: s.approverUids.map((u) => people.get(u)?.name || '') })) });
}

async function mine(who: Who): Promise<Result> {
  const rs = (await db().collection(RQ).where('companyId', '==', who.cid).get()).docs.map((d: any) => d.data()).filter((r: any) => r.requesterUid === who.uid);
  return ok({ items: rs.sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))).map(row) });
}

async function inbox(who: Who): Promise<Result> {
  const rs = (await db().collection(RQ).where('companyId', '==', who.cid).get()).docs.map((d: any) => d.data()).filter((r: any) => canDecide(r, who.uid).ok);
  return ok({ items: rs.sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt))).map((r: any) => ({ ...row(r), details: r.details })) });
}

async function load(who: Who, id: string): Promise<any> {
  const snap = await db().collection(RQ).doc(id).get();
  const r: any = snap.exists ? snap.data() : null;
  if (!r || r.companyId !== who.cid) throw new WorkError(404, 'Request not found.');
  const involved = r.requesterUid === who.uid || r.steps.some((s: any) => s.approverUids.includes(who.uid));
  if (!involved && !who.can('workflow.manage')) throw new WorkError(404, 'Request not found.');
  return r;
}

async function get(who: Who, q: any): Promise<Result> {
  const r = await load(who, str(q.id, 80));
  const people = await peopleMap(who.cid);
  return ok({ request: { ...row(r), details: r.details, chainName: r.chainName, history: r.history, steps: r.steps.map((s: any) => ({ name: s.name, status: s.status, mode: s.mode, approvers: s.approverUids.map((u: string) => ({ uid: u, name: people.get(u)?.name || '', approved: s.approvedBy.includes(u) })) })) }, canDecide: canDecide(r, who.uid) });
}

async function decideReq(who: Who, body: any): Promise<Result> {
  const id = str(body?.id, 80);
  const approve = body?.approve === true;
  const note = str(body?.note, 400);
  if (!approve && !note) return fail(400, 'Say why you are rejecting it.');
  let notifyUids: string[] = [], text = '', title = '', requester = '';
  await db().runTransaction(async (tx: any) => {
    const ref = db().collection(RQ).doc(id);
    const snap = await tx.get(ref);
    const r: any = snap.exists ? snap.data() : null;
    if (!r || r.companyId !== who.cid) throw new WorkError(404, 'Request not found.');
    const can = canDecide(r, who.uid);
    if (!can.ok) throw new WorkError(409, can.reason || 'You cannot decide this.');
    const step = r.steps[r.current].name;
    const { req, event } = applyDecision(r, who.uid, approve);
    const now = nowIso();
    req.history.push({ at: now, action: approve ? 'APPROVED' : 'REJECTED', step, uid: who.uid, name: who.name, ...(note ? { note } : {}) });
    if (event === 'APPROVED') req.history.push({ at: now, action: 'COMPLETED' });
    tx.set(ref, req);
    title = req.title; requester = req.requesterUid;
    if (event === 'STEP_APPROVED') { notifyUids = req.steps[req.current].approverUids; text = `${req.requesterName}: ${req.title}`; }
    else if (event === 'APPROVED') { notifyUids = [req.requesterUid]; text = `"${req.title}" was approved.`; }
    else if (event === 'REJECTED') { notifyUids = [req.requesterUid]; text = `"${req.title}" was rejected: ${note}`; }
  });
  if (notifyUids.length) await inApp(who.cid, notifyUids, notifyUids.includes(requester) ? 'Request decided' : 'Approval needed', text || title, '', `approval-${id}-${Date.now()}`);
  return ok({ decided: true });
}

async function cancel(who: Who, body: any): Promise<Result> {
  await db().runTransaction(async (tx: any) => {
    const ref = db().collection(RQ).doc(str(body?.id, 80));
    const snap = await tx.get(ref);
    const r: any = snap.exists ? snap.data() : null;
    if (!r || r.companyId !== who.cid || r.requesterUid !== who.uid) throw new WorkError(404, 'Request not found.');
    if (r.status !== 'PENDING') throw new WorkError(409, `It is already ${r.status.toLowerCase()}.`);
    r.status = 'CANCELLED';
    r.history.push({ at: nowIso(), action: 'CANCELLED', uid: who.uid, name: who.name });
    tx.set(ref, r);
  });
  return ok({ cancelled: true });
}

export async function routeApprovals(r: WorkReq): Promise<Result> {
  const out = await guarded(async () => {
    const who = await whoIs(r.headers);
    const GET = r.method === 'GET', POST = r.method === 'POST';
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'kinds': if (GET) return kinds(who); break;
      case 'chains': if (GET) return chains(who); break;
      case 'save-chain': if (POST) return saveChain(who, body); break;
      case 'delete-chain': if (POST) return deleteChain(who, body); break;
      case 'submit': if (POST) return submit(who, body); break;
      case 'mine': if (GET) return mine(who); break;
      case 'inbox': if (GET) return inbox(who); break;
      case 'get': if (GET) return get(who, r.query); break;
      case 'decide': if (POST) return decideReq(who, body); break;
      case 'cancel': if (POST) return cancel(who, body); break;
      default: return fail(404, `Unknown approvals action '${r.action}'.`);
    }
    return fail(405, 'Method not allowed.');
  }, authErrorResponse);
  return out || fail(500, 'No result.');
}
