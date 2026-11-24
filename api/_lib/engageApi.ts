/**
 * Surveys, feedback and the social wall: /api/leave/engage-<action>.
 *
 * Surveys
 *   surveys (GET)               open surveys for me (+ all of them for engage.manage)
 *   survey (GET id)             one survey to answer; managers also get status and counts
 *   save-survey (POST)          create or edit a draft                          engage.manage
 *   publish-survey / close-survey (POST id)                                     engage.manage
 *   delete-survey (POST id)     removes it and its answers                      engage.manage
 *   respond (POST id, answers)  once per person
 *   results (GET id)            aggregated; anonymous surveys wait for MIN_ANON answers    engage.manage
 * Wall
 *   feed (GET before?)          pinned first, then newest
 *   post (POST)                 text, kind POST | KUDOS (kudosTo) | ANNOUNCEMENT (engage.manage)
 *   comment (POST postId, text) react (POST postId, reaction)  pin (POST postId, pinned)  delete-post / delete-comment (POST)
 *
 *   surveys/{id}                 survey, questions, status; `salt` (server-only) keys anonymous response ids
 *   surveyResponses/{id}         one person's answers. Anonymous: id = HMAC(salt, uid), no uid stored.
 *   wallPosts/{id}  wallComments/{id}
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { authErrorResponse } from './authContext.js';
import { inApp } from './leaveCore.js';
import {
  MAX_COMMENT, MAX_COMMENTS_PER_DAY, MAX_POST, MAX_POSTS_PER_DAY, MIN_ANON, REACTIONS, WALL_KINDS, aggregate, cleanQuestions, validateAnswers, type WallKind,
} from '../../shared/engage.js';
import { WorkError, db, fail, guarded, need, nowIso, ok, peopleMap, str, whoIs, type Result, type WorkReq, type Who } from './workKit.js';

const respId = (salt: string, surveyId: string, uid: string) => `${surveyId}__${createHmac('sha256', salt).update(uid).digest('hex').slice(0, 40)}`;

async function department(who: Who): Promise<string> {
  return (await peopleMap(who.cid)).get(who.uid)?.department || '';
}

function inAudience(s: any, dept: string) {
  const a = s.audience;
  return !a || a.kind !== 'DEPARTMENTS' || (Array.isArray(a.departments) && a.departments.includes(dept));
}
const isOpen = (s: any) => s.status === 'OPEN' && (!s.closesAt || s.closesAt >= nowIso().slice(0, 10));
const publicSurvey = (s: any) => { const { salt, ...rest } = s; void salt; return rest; };

// ------------------------------------------------------------------ surveys

async function listSurveys(who: Who): Promise<Result> {
  const snap = await db().collection('surveys').where('companyId', '==', who.cid).get();
  const manage = who.can('engage.manage');
  const dept = await department(who);
  const mineSnap = await db().collection('surveyResponses').where('companyId', '==', who.cid).get();
  const answered = new Set<string>();
  const counts = new Map<string, number>();
  for (const d of mineSnap.docs) {
    const x: any = d.data();
    counts.set(x.surveyId, (counts.get(x.surveyId) || 0) + 1);
    const s = snap.docs.find((y: any) => y.id === x.surveyId)?.data() as any;
    if (s && d.id === (s.anonymous ? respId(s.salt, s.id, who.uid) : `${s.id}__${who.uid}`)) answered.add(s.id);
  }
  const items = snap.docs.map((d: any) => d.data())
    .filter((s: any) => manage || (isOpen(s) && inAudience(s, dept)))
    .map((s: any) => ({ id: s.id, title: s.title, description: s.description, anonymous: s.anonymous, status: s.status, closesAt: s.closesAt || '', questions: s.questions.length, createdAt: s.createdAt, audience: s.audience,
      answered: answered.has(s.id), ...(manage ? { responses: counts.get(s.id) || 0 } : {}) }))
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return ok({ items, canManage: manage });
}

async function loadSurvey(who: Who, id: string): Promise<any> {
  const snap = await db().collection('surveys').doc(id).get();
  const s = snap.exists ? (snap.data() as any) : null;
  if (!s || s.companyId !== who.cid) throw new WorkError(404, 'Survey not found.');
  return s;
}

async function getSurvey(who: Who, q: any): Promise<Result> {
  const s = await loadSurvey(who, str(q.id, 80));
  const manage = who.can('engage.manage');
  if (!manage && (!isOpen(s) || !inAudience(s, await department(who)))) throw new WorkError(404, 'Survey not found.');
  const already = (await db().collection('surveyResponses').doc(s.anonymous ? respId(s.salt, s.id, who.uid) : `${s.id}__${who.uid}`).get()).exists;
  return ok({ survey: publicSurvey(s), answered: already });
}

async function saveSurvey(who: Who, body: any): Promise<Result> {
  need(who, 'engage.manage');
  const title = str(body?.title, 160);
  if (!title) return fail(400, 'Give the survey a title.');
  const { questions, error } = cleanQuestions(body?.questions);
  if (error) return fail(400, error);
  const id = str(body?.id, 80) || randomUUID();
  const prev = await db().collection('surveys').doc(id).get();
  const old: any = prev.exists ? prev.data() : null;
  if (old && old.companyId !== who.cid) return fail(404, 'Survey not found.');
  if (old && old.status !== 'DRAFT') return fail(409, 'A survey cannot be edited once it is open. Close it and make a new one.');
  const closesAt = str(body?.closesAt, 10);
  if (closesAt && !/^\d{4}-\d{2}-\d{2}$/.test(closesAt)) return fail(400, 'Closing date must be a valid date.');
  const depts: string[] = Array.from(new Set((Array.isArray(body?.audience?.departments) ? body.audience.departments : []).map((x: any) => str(x, 80)).filter(Boolean)));
  const audience = body?.audience?.kind === 'DEPARTMENTS' && depts.length ? { kind: 'DEPARTMENTS', departments: depts } : { kind: 'ALL' };
  const doc = {
    id, companyId: who.cid, title, description: str(body?.description, 600), anonymous: body?.anonymous === true, questions, audience, closesAt,
    status: 'DRAFT', salt: old?.salt || randomBytes(16).toString('hex'), createdBy: old?.createdBy || who.uid, createdAt: old?.createdAt || nowIso(), updatedAt: nowIso(),
  };
  await db().collection('surveys').doc(id).set(doc);
  return ok({ id });
}

async function setStatus(who: Who, body: any, to: 'OPEN' | 'CLOSED'): Promise<Result> {
  need(who, 'engage.manage');
  const s = await loadSurvey(who, str(body?.id, 80));
  if (to === 'OPEN' && s.status !== 'DRAFT') return fail(409, 'Only a draft can be published.');
  if (to === 'CLOSED' && s.status !== 'OPEN') return fail(409, 'Only an open survey can be closed.');
  await db().collection('surveys').doc(s.id).set({ status: to, ...(to === 'OPEN' ? { openedAt: nowIso() } : { closedAt: nowIso() }) }, { merge: true });
  if (to === 'OPEN') {
    const people = [...(await peopleMap(who.cid)).values()].filter((p) => p.active && inAudience(s, p.department));
    await inApp(who.cid, people.map((p) => p.uid), 'New survey', `${s.title}${s.anonymous ? ' (anonymous)' : ''}`, '', `survey-${s.id}`);
  }
  return ok({ status: to });
}

async function deleteSurvey(who: Who, body: any): Promise<Result> {
  need(who, 'engage.manage');
  const s = await loadSurvey(who, str(body?.id, 80));
  const rs = await db().collection('surveyResponses').where('companyId', '==', who.cid).where('surveyId', '==', s.id).get();
  await Promise.all(rs.docs.map((d: any) => d.ref.delete()));
  await db().collection('surveys').doc(s.id).delete();
  return ok({ deleted: true });
}

async function respond(who: Who, body: any): Promise<Result> {
  const s = await loadSurvey(who, str(body?.id, 80));
  if (!isOpen(s)) return fail(409, 'This survey is not open.');
  if (!inAudience(s, await department(who))) return fail(403, 'This survey is not for you.');
  const { answers, error } = validateAnswers(s, body?.answers);
  if (error) return fail(400, error);
  const id = s.anonymous ? respId(s.salt, s.id, who.uid) : `${s.id}__${who.uid}`;
  const doc: any = { companyId: who.cid, surveyId: s.id, answers, ...(s.anonymous ? {} : { uid: who.uid, name: who.name }) };
  // the creation time of an anonymous answer is rounded to the day so it cannot be matched to a login time
  doc.submittedAt = s.anonymous ? nowIso().slice(0, 10) : nowIso();
  const ref = db().collection('surveyResponses').doc(id);
  let dup = false;
  await db().runTransaction(async (tx: any) => { const snap = await tx.get(ref); if (snap.exists) { dup = true; return; } tx.set(ref, doc); });
  if (dup) return fail(409, 'You have already answered this survey.');
  return ok({ thanks: true });
}

async function results(who: Who, q: any): Promise<Result> {
  need(who, 'engage.manage');
  const s = await loadSurvey(who, str(q.id, 80));
  const rs = await db().collection('surveyResponses').where('companyId', '==', who.cid).where('surveyId', '==', s.id).get();
  const rows = rs.docs.map((d: any) => d.data());
  const people = [...(await peopleMap(who.cid)).values()].filter((p) => p.active && inAudience(s, p.department));
  const base = { survey: { id: s.id, title: s.title, anonymous: s.anonymous, status: s.status, closesAt: s.closesAt || '' }, responses: rows.length, invited: people.length };
  if (s.anonymous && rows.length < MIN_ANON) return ok({ ...base, hidden: true, message: `Results of an anonymous survey show once ${MIN_ANON} people have answered (${rows.length} so far).` });
  return ok({ ...base, hidden: false, questions: aggregate(s, rows, s.id) });
}

// ------------------------------------------------------------------ wall

const dayStart = () => new Date(Date.now() - 24 * 3600_000).toISOString();

async function feed(who: Who, q: any): Promise<Result> {
  const snap = await db().collection('wallPosts').where('companyId', '==', who.cid).get();
  const before = str(q.before, 40);
  let posts = snap.docs.map((d: any) => d.data()).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (before) posts = posts.filter((p: any) => p.createdAt < before);
  const page = posts.slice(0, 30);
  const first = !before;
  const pinned = first ? snap.docs.map((d: any) => d.data()).filter((p: any) => p.pinned).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))) : [];
  const shown = [...pinned, ...page.filter((p: any) => !pinned.some((x: any) => x.id === p.id))];
  const cs = await db().collection('wallComments').where('companyId', '==', who.cid).get();
  const byPost = new Map<string, any[]>();
  for (const d of cs.docs) { const c: any = d.data(); if (shown.some((p: any) => p.id === c.postId)) byPost.set(c.postId, [...(byPost.get(c.postId) || []), c]); }
  const manage = who.can('engage.manage');
  return ok({
    items: shown.map((p: any) => ({
      id: p.id, kind: p.kind, text: p.text, authorUid: p.authorUid, authorName: p.authorName, createdAt: p.createdAt, pinned: !!p.pinned, kudosTo: p.kudosTo || [],
      reactions: Object.fromEntries(REACTIONS.map((r) => [r, (p.reactions?.[r] || []).length])), myReactions: REACTIONS.filter((r) => (p.reactions?.[r] || []).includes(who.uid)),
      comments: (byPost.get(p.id) || []).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map((c) => ({ id: c.id, text: c.text, authorUid: c.authorUid, authorName: c.authorName, createdAt: c.createdAt, canDelete: manage || c.authorUid === who.uid })),
      canDelete: manage || p.authorUid === who.uid,
    })),
    next: page.length === 30 ? page[page.length - 1].createdAt : '', canManage: manage,
  });
}

async function post(who: Who, body: any): Promise<Result> {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return fail(400, 'Write something first.');
  if (text.length > MAX_POST) return fail(400, `Posts can be at most ${MAX_POST} characters.`);
  const kind: WallKind = WALL_KINDS.includes(body?.kind) ? body.kind : 'POST';
  if (kind === 'ANNOUNCEMENT') need(who, 'engage.manage', 'Only people who manage engagement can post announcements.');
  let kudosTo: string[] = [];
  if (kind === 'KUDOS') {
    const people = await peopleMap(who.cid);
    kudosTo = (Array.from(new Set((Array.isArray(body?.kudosTo) ? body.kudosTo : []).map((x: any) => str(x, 128)))) as string[]).filter((u) => u !== who.uid && people.get(u)?.active).slice(0, 10);
    if (!kudosTo.length) return fail(400, 'Choose who you are thanking.');
  }
  const recent = (await db().collection('wallPosts').where('companyId', '==', who.cid).where('authorUid', '==', who.uid).get()).docs.filter((d: any) => (d.data() as any).createdAt > dayStart());
  if (recent.length >= MAX_POSTS_PER_DAY) return fail(429, 'That is enough posting for one day. Try again tomorrow.');
  const id = randomUUID();
  await db().collection('wallPosts').doc(id).set({ id, companyId: who.cid, kind, text, authorUid: who.uid, authorName: who.name, kudosTo, pinned: false, reactions: {}, createdAt: nowIso() });
  if (kudosTo.length) await inApp(who.cid, kudosTo, 'You got kudos', `${who.name}: ${text.slice(0, 120)}`, '', `kudos-${id}`);
  return ok({ id });
}

async function loadPost(who: Who, id: string): Promise<any> {
  const snap = await db().collection('wallPosts').doc(id).get();
  const p = snap.exists ? (snap.data() as any) : null;
  if (!p || p.companyId !== who.cid) throw new WorkError(404, 'Post not found.');
  return p;
}

async function comment(who: Who, body: any): Promise<Result> {
  const p = await loadPost(who, str(body?.postId, 80));
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return fail(400, 'Write a comment first.');
  if (text.length > MAX_COMMENT) return fail(400, `Comments can be at most ${MAX_COMMENT} characters.`);
  const recent = (await db().collection('wallComments').where('companyId', '==', who.cid).where('authorUid', '==', who.uid).get()).docs.filter((d: any) => (d.data() as any).createdAt > dayStart());
  if (recent.length >= MAX_COMMENTS_PER_DAY) return fail(429, 'That is enough commenting for one day.');
  const id = randomUUID();
  await db().collection('wallComments').doc(id).set({ id, companyId: who.cid, postId: p.id, text, authorUid: who.uid, authorName: who.name, createdAt: nowIso() });
  if (p.authorUid !== who.uid) await inApp(who.cid, [p.authorUid], 'New comment', `${who.name} commented on your post.`, '', `comment-${id}`);
  return ok({ id });
}

async function react(who: Who, body: any): Promise<Result> {
  const reaction = str(body?.reaction, 12);
  if (!(REACTIONS as readonly string[]).includes(reaction)) return fail(400, 'Unknown reaction.');
  const ref = db().collection('wallPosts').doc(str(body?.postId, 80));
  let on = false;
  await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const p: any = snap.exists ? snap.data() : null;
    if (!p || p.companyId !== who.cid) throw new WorkError(404, 'Post not found.');
    const list: string[] = p.reactions?.[reaction] || [];
    on = !list.includes(who.uid);
    p.reactions = { ...(p.reactions || {}), [reaction]: on ? [...list, who.uid].slice(-5000) : list.filter((u) => u !== who.uid) };
    tx.set(ref, p);
  });
  return ok({ on });
}

async function pin(who: Who, body: any): Promise<Result> {
  need(who, 'engage.manage');
  const p = await loadPost(who, str(body?.postId, 80));
  await db().collection('wallPosts').doc(p.id).set({ pinned: body?.pinned === true }, { merge: true });
  return ok({ pinned: body?.pinned === true });
}

async function deletePost(who: Who, body: any): Promise<Result> {
  const p = await loadPost(who, str(body?.postId, 80));
  if (p.authorUid !== who.uid && !who.can('engage.manage')) return fail(403, 'You can only delete your own posts.');
  const cs = await db().collection('wallComments').where('companyId', '==', who.cid).where('postId', '==', p.id).get();
  await Promise.all(cs.docs.map((d: any) => d.ref.delete()));
  await db().collection('wallPosts').doc(p.id).delete();
  return ok({ deleted: true });
}

async function deleteComment(who: Who, body: any): Promise<Result> {
  const ref = db().collection('wallComments').doc(str(body?.id, 80));
  const snap = await ref.get();
  const c: any = snap.exists ? snap.data() : null;
  if (!c || c.companyId !== who.cid) return fail(404, 'Comment not found.');
  if (c.authorUid !== who.uid && !who.can('engage.manage')) return fail(403, 'You can only delete your own comments.');
  await ref.delete();
  return ok({ deleted: true });
}

/** The company directory (names only) for pickers: everyone in a company can see who works there. */
async function directory(who: Who): Promise<Result> {
  const items = [...(await peopleMap(who.cid)).values()].filter((p) => p.active).map((p) => ({ uid: p.uid, name: p.name, department: p.department })).sort((a, b) => a.name.localeCompare(b.name));
  return ok({ items, me: who.uid });
}

export async function routeEngage(r: WorkReq): Promise<Result> {
  const out = await guarded(async () => {
    const who = await whoIs(r.headers);
    const GET = r.method === 'GET', POST = r.method === 'POST';
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'directory': if (GET) return directory(who); break;
      case 'surveys': if (GET) return listSurveys(who); break;
      case 'survey': if (GET) return getSurvey(who, r.query); break;
      case 'save-survey': if (POST) return saveSurvey(who, body); break;
      case 'publish-survey': if (POST) return setStatus(who, body, 'OPEN'); break;
      case 'close-survey': if (POST) return setStatus(who, body, 'CLOSED'); break;
      case 'delete-survey': if (POST) return deleteSurvey(who, body); break;
      case 'respond': if (POST) return respond(who, body); break;
      case 'results': if (GET) return results(who, r.query); break;
      case 'feed': if (GET) return feed(who, r.query); break;
      case 'post': if (POST) return post(who, body); break;
      case 'comment': if (POST) return comment(who, body); break;
      case 'react': if (POST) return react(who, body); break;
      case 'pin': if (POST) return pin(who, body); break;
      case 'delete-post': if (POST) return deletePost(who, body); break;
      case 'delete-comment': if (POST) return deleteComment(who, body); break;
      default: return fail(404, `Unknown engage action '${r.action}'.`);
    }
    return fail(405, 'Method not allowed.');
  }, authErrorResponse);
  return out || fail(500, 'No result.');
}
