/**
 * E-signature: /api/leave/esign-<action>.
 *
 *   mine (GET)            what is waiting for me, what I signed, what I sent
 *   all (GET)             every request in the company                           esign.manage
 *   get (GET id)          one request; the signer, the sender or esign.manage
 *   create (POST)         title, body, signerUids, ordered, expiresInDays         esign.manage
 *   sign (POST)           id, typedName, consent                                  a signer
 *   decline (POST)        id, reason                                              a signer
 *   cancel (POST)         id                                                      the sender or esign.manage
 *   verify (GET id)       checks the stored text still matches its hash
 *
 *   esignRequests/{id}    the request, signers and an audit trail of events. The text is fixed at creation.
 */
import { createHash, randomUUID } from 'node:crypto';
import { authErrorResponse } from './authContext.js';
import { inApp } from './leaveCore.js';
import { MAX_BODY, MAX_SIGNERS, canSignNow, certificateOf, nameMatches, statusOf, whoseTurn, type Signer } from '../../shared/esign.js';
import { WorkError, db, fail, guarded, need, nowIso, numIn, ok, peopleMap, str, whoIs, type Result, type WorkReq, type Who } from './workKit.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hashOf = (title: string, body: string) => sha(`${title}\n${body}`);

const COL = 'esignRequests';
const row = (d: any) => ({ id: d.id, title: d.title, status: statusOf(d), createdAt: d.createdAt, createdByName: d.createdByName, ordered: d.ordered, expiresAt: d.expiresAt,
  signers: d.signers.map((s: Signer) => ({ uid: s.uid, name: s.name, status: s.status, signedAt: s.signedAt || '', order: s.order })), completedAt: d.completedAt || '' });

async function mine(who: Who): Promise<Result> {
  const snap = await db().collection(COL).where('companyId', '==', who.cid).get();
  const all = snap.docs.map((x: any) => x.data());
  const involved = all.filter((d: any) => d.signers.some((s: Signer) => s.uid === who.uid));
  const toSign = involved.filter((d: any) => canSignNow(d, who.uid).ok);
  const waiting = involved.filter((d: any) => !toSign.includes(d) && statusOf(d) === 'PENDING' && d.signers.find((s: Signer) => s.uid === who.uid)?.status === 'PENDING');
  const done = involved.filter((d: any) => !toSign.includes(d) && !waiting.includes(d));
  const sent = all.filter((d: any) => d.createdBy === who.uid);
  const byNew = (a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt));
  return ok({ toSign: toSign.sort(byNew).map(row), waiting: waiting.sort(byNew).map(row), done: done.sort(byNew).map(row), sent: sent.sort(byNew).map(row), canManage: who.can('esign.manage') });
}

async function all(who: Who): Promise<Result> {
  need(who, 'esign.manage');
  const snap = await db().collection(COL).where('companyId', '==', who.cid).get();
  return ok({ items: snap.docs.map((x: any) => row(x.data())).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))) });
}

async function load(who: Who, id: string): Promise<any> {
  const snap = await db().collection(COL).doc(id).get();
  const d = snap.exists ? (snap.data() as any) : null;
  if (!d || d.companyId !== who.cid) throw new WorkError(404, 'Request not found.');
  if (!who.can('esign.manage') && d.createdBy !== who.uid && !d.signers.some((s: Signer) => s.uid === who.uid)) throw new WorkError(404, 'Request not found.');
  return d;
}

async function get(who: Who, q: any): Promise<Result> {
  const d = await load(who, str(q.id, 80));
  const status = statusOf(d);
  const certificate = status === 'COMPLETED' ? certificateOf({ id: d.id, title: d.title, hash: d.docHash, createdAt: d.createdAt, createdByName: d.createdByName, signers: d.signers }) : null;
  return ok({ request: { ...row(d), body: d.body, docHash: d.docHash, events: d.events, mine: d.signers.find((s: Signer) => s.uid === who.uid) || null, turn: whoseTurn(d).map((s) => s.name) }, canSign: canSignNow(d, who.uid), certificate });
}

async function create(who: Who, body: any): Promise<Result> {
  need(who, 'esign.manage');
  const title = str(body?.title, 160);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!title) return fail(400, 'Give the document a title.');
  if (!text) return fail(400, 'Paste the text to be signed.');
  if (text.length > MAX_BODY) return fail(400, `The text is too long (at most ${MAX_BODY} characters).`);
  const uids: string[] = Array.from(new Set((Array.isArray(body?.signerUids) ? body.signerUids : []).map((x: any) => str(x, 128)).filter(Boolean)));
  if (!uids.length) return fail(400, 'Choose at least one signer.');
  if (uids.length > MAX_SIGNERS) return fail(400, `At most ${MAX_SIGNERS} signers.`);
  const people = await peopleMap(who.cid);
  const signers: Signer[] = uids.map((uid, i) => {
    const p = people.get(uid);
    if (!p || !p.active) throw new WorkError(400, 'One of the signers is not an active employee of this company.');
    return { uid, name: p.name, email: p.email, order: i + 1, status: 'PENDING' };
  });
  const days = numIn(body?.expiresInDays, 'Expiry', 1, 365, 30);
  const now = nowIso();
  const id = randomUUID();
  const doc = {
    id, companyId: who.cid, title, body: text, docHash: hashOf(title, text), createdBy: who.uid, createdByName: who.name, createdAt: now,
    ordered: body?.ordered === true, expiresAt: new Date(Date.now() + days * 86400_000).toISOString(), status: 'PENDING', signers,
    events: [{ at: now, action: 'CREATED', uid: who.uid, name: who.name }],
  };
  await db().collection(COL).doc(id).set(doc);
  await inApp(who.cid, whoseTurn(doc as any).map((s) => s.uid), 'Document to sign', `${who.name} sent you "${title}" to sign.`, '', `esign-${id}`);
  return ok({ id });
}

async function sign(who: Who, body: any, ip: string): Promise<Result> {
  const id = str(body?.id, 80);
  if (body?.consent !== true) return fail(400, 'Tick the box to confirm you agree to sign.');
  const typed = str(body?.typedName, 120);
  let turnNext: string[] = [], title = '', creator = '';
  await db().runTransaction(async (tx: any) => {
    const ref = db().collection(COL).doc(id);
    const snap = await tx.get(ref);
    const d: any = snap.exists ? snap.data() : null;
    if (!d || d.companyId !== who.cid) throw new WorkError(404, 'Request not found.');
    const can = canSignNow(d, who.uid);
    if (!can.ok) throw new WorkError(409, can.reason || 'You cannot sign this.');
    if (hashOf(d.title, d.body) !== d.docHash) throw new WorkError(409, 'This document no longer matches the text that was sent. Do not sign; tell the sender.');
    const me = d.signers.find((s: Signer) => s.uid === who.uid)!;
    if (!nameMatches(typed, me.name)) throw new WorkError(400, `Type your full name as it appears here: ${me.name}.`);
    const now = nowIso();
    me.status = 'SIGNED'; me.signedAt = now; me.typedName = typed; me.ip = ip || '';
    d.events.push({ at: now, action: 'SIGNED', uid: who.uid, name: who.name, ip: ip || '' });
    d.status = statusOf(d);
    if (d.status === 'COMPLETED') { d.completedAt = now; d.events.push({ at: now, action: 'COMPLETED' }); }
    tx.set(ref, d);
    turnNext = d.status === 'PENDING' ? whoseTurn(d).map((s) => s.uid) : [d.createdBy]; title = d.title; creator = d.createdBy;
  });
  await inApp(who.cid, turnNext, creator && turnNext.includes(creator) ? 'Document fully signed' : 'Document to sign', `"${title}" ${turnNext.includes(creator) ? 'has been signed by everyone.' : 'is waiting for your signature.'}`, '', `esign-${id}-${turnNext.join('-')}`);
  return ok({ signed: true });
}

async function decline(who: Who, body: any, ip: string): Promise<Result> {
  const id = str(body?.id, 80);
  const reason = str(body?.reason, 300);
  if (!reason) return fail(400, 'Say why you are declining.');
  let creator = '', title = '';
  await db().runTransaction(async (tx: any) => {
    const ref = db().collection(COL).doc(id);
    const snap = await tx.get(ref);
    const d: any = snap.exists ? snap.data() : null;
    if (!d || d.companyId !== who.cid) throw new WorkError(404, 'Request not found.');
    const can = canSignNow(d, who.uid);
    if (!can.ok) throw new WorkError(409, can.reason || 'You cannot decline this.');
    const me = d.signers.find((s: Signer) => s.uid === who.uid)!;
    me.status = 'DECLINED'; me.declineReason = reason;
    const now = nowIso();
    d.events.push({ at: now, action: 'DECLINED', uid: who.uid, name: who.name, ip: ip || '', reason });
    d.status = statusOf(d);
    tx.set(ref, d);
    creator = d.createdBy; title = d.title;
  });
  await inApp(who.cid, [creator], 'Signature declined', `${who.name} declined to sign "${title}": ${reason}`, '', `esign-${id}-declined`);
  return ok({ declined: true });
}

async function cancel(who: Who, body: any): Promise<Result> {
  const id = str(body?.id, 80);
  await db().runTransaction(async (tx: any) => {
    const ref = db().collection(COL).doc(id);
    const snap = await tx.get(ref);
    const d: any = snap.exists ? snap.data() : null;
    if (!d || d.companyId !== who.cid) throw new WorkError(404, 'Request not found.');
    if (d.createdBy !== who.uid && !who.can('esign.manage')) throw new WorkError(403, 'Only the sender can cancel this.');
    if (statusOf(d) === 'COMPLETED') throw new WorkError(409, 'It is already fully signed.');
    d.status = 'CANCELLED';
    d.events.push({ at: nowIso(), action: 'CANCELLED', uid: who.uid, name: who.name });
    tx.set(ref, d);
  });
  return ok({ cancelled: true });
}

async function verify(who: Who, q: any): Promise<Result> {
  const d = await load(who, str(q.id, 80));
  return ok({ intact: hashOf(d.title, d.body) === d.docHash, docHash: d.docHash });
}

export async function routeEsign(r: WorkReq): Promise<Result> {
  const out = await guarded(async () => {
    const who = await whoIs(r.headers);
    const GET = r.method === 'GET', POST = r.method === 'POST';
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    const ip = (r.ip || '').replace(/^::ffff:/, '');
    switch (r.action) {
      case 'mine': if (GET) return mine(who); break;
      case 'all': if (GET) return all(who); break;
      case 'get': if (GET) return get(who, r.query); break;
      case 'create': if (POST) return create(who, body); break;
      case 'sign': if (POST) return sign(who, body, ip); break;
      case 'decline': if (POST) return decline(who, body, ip); break;
      case 'cancel': if (POST) return cancel(who, body); break;
      case 'verify': if (GET) return verify(who, r.query); break;
      default: return fail(404, `Unknown e-sign action '${r.action}'.`);
    }
    return fail(405, 'Method not allowed.');
  }, authErrorResponse);
  return out || fail(500, 'No result.');
}
