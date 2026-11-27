/**
 * Who may send email from the browser: /api/email/config | send | test (shared by server.ts and api/email).
 *
 * The company's mailbox is shared, so the browser is never trusted with it:
 *   - send: any signed-in person of an active company, but ONLY to an active employee of that same company
 *     (that is all the app's own screens do), plain text only, with an hourly limit per person.
 *   - test: company admins or people who manage users, and the message only ever goes to the caller's own address.
 *   - config: everyone learns whether email is on; only administrators see the mailbox name.
 * Email the server itself sends (offers, interviews, hiring flow, reminders) calls dispatchLiveEmail directly.
 */
import { adminDb } from './firebaseAdmin.js';
import { AuthError, authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { dispatchLiveEmail, getEmailConfigStatus, type EmailDispatchPayload } from './serverEmail.js';

export interface EmailRequest { method: string; action: string; body: any; headers: Record<string, any> }
type Res = { status: number; json: any };

/** Emails one person may send from the browser in an hour. Publishing a policy writes to every employee, so authors get more. */
export const HOURLY_LIMIT = { author: 1000, member: 30 };
const AUTHOR_PERMS = ['doc.create', 'doc.publish', 'doc.review', 'req.hr_decide', 'req.assign', 'req.founder_decide', 'users.manage'];

let mailer: typeof dispatchLiveEmail = dispatchLiveEmail;
/** Tests swap the mailer so nothing leaves the machine. */
export const __setGateMailer = (fn: typeof dispatchLiveEmail | null) => { mailer = fn || dispatchLiveEmail; };

const fail = (status: number, error: string): Res => ({ status, json: { success: false, error } });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const oneLine = (v: unknown, max: number) => str(v, max * 2).replace(/[\r\n\u0000-\u001F]+/g, ' ').trim().slice(0, max);
const ADDRESS = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;

const isAdmin = (c: AuthContext) => c.isCompanyAdmin || c.perms.includes('users.manage');

const staffCache = new Map<string, { at: number; emails: Set<string> }>();
export const __clearGateCache = () => staffCache.clear();
async function isColleague(cid: string, email: string): Promise<boolean> {
  const hit = staffCache.get(cid);
  if (hit && Date.now() - hit.at < 30_000 && hit.emails.has(email)) return true;
  const snap = await adminDb().collection('employees').where('companyId', '==', cid).get();
  const emails = new Set<string>();
  for (const d of snap.docs) {
    if (d.get('active') === false) continue;
    const e = String(d.get('email') || '').trim().toLowerCase();
    if (e) emails.add(e);
  }
  staffCache.set(cid, { at: Date.now(), emails });
  return emails.has(email);
}

/** Counts in the database, so the limit also holds across serverless instances and restarts. */
async function takeQuota(c: AuthContext, limit: number): Promise<boolean> {
  const hour = new Date().toISOString().slice(0, 13);
  const ref = adminDb().collection('emailQuota').doc(`${c.companyId}_${c.uid}_${hour}`);
  let allowed = false;
  await adminDb().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? Number(snap.get('used') || 0) : 0;
    allowed = used < limit;
    if (allowed) tx.set(ref, { companyId: c.companyId, uid: c.uid, hour, used: used + 1 });
  });
  return allowed;
}

async function send(c: AuthContext, b: any): Promise<Res> {
  const to = str(b.to, 200).trim();
  if (!ADDRESS.test(to)) return fail(400, 'One valid email address is required.');
  const subject = oneLine(b.subject, 300);
  const body = str(b.body, 20_000);
  if (!subject || !body.trim()) return fail(400, 'A subject and a message are required.');
  if (!(await isColleague(c.companyId!, to.toLowerCase()))) return fail(403, 'Email from the app can only go to people in your own company.');
  const author = c.isCompanyAdmin || AUTHOR_PERMS.some((p) => c.perms.includes(p));
  if (!(await takeQuota(c, author ? HOURLY_LIMIT.author : HOURLY_LIMIT.member))) return fail(429, 'You have reached the hourly email limit. Please try again later.');

  const m = b.metadata && typeof b.metadata === 'object' ? b.metadata : null;
  const payload: EmailDispatchPayload = {
    to,
    recipientName: oneLine(b.recipientName, 120) || to,
    subject,
    body,
    ...(m ? { metadata: {
      documentId: oneLine(m.documentId, 120) || undefined, documentTitle: oneLine(m.documentTitle, 200) || undefined,
      versionNumber: oneLine(m.versionNumber, 30) || undefined, acknowledgementRequired: m.acknowledgementRequired === true,
    } } : {}),
  };
  const result = await mailer(payload);
  return { status: result.success ? 200 : 500, json: result };
}

async function test(c: AuthContext): Promise<Res> {
  if (!isAdmin(c)) return fail(403, 'Only administrators can send a test email.');
  if (!ADDRESS.test(c.email)) return fail(400, 'Your sign-in has no email address to send the test to.');
  if (!(await takeQuota(c, HOURLY_LIMIT.member))) return fail(429, 'You have reached the hourly email limit. Please try again later.');
  const result = await mailer({
    to: c.email, recipientName: c.email, subject: 'Test email from your HR portal',
    body: `Hello,\n\nThis is a test message sent to ${c.email} to confirm that email from your HR portal is working.\n`,
  });
  return { status: result.success ? 200 : 500, json: { ...result, sentTo: c.email } };
}

export async function routeEmail(r: EmailRequest): Promise<Res> {
  try {
    const c = await requireActiveTenant(r.headers);
    if (r.action === 'config') {
      const s = getEmailConfigStatus();
      if (isAdmin(c) || c.isPlatformAdmin) return { status: 200, json: s };
      return { status: 200, json: { isConfigured: s.isConfigured, smtpConfigured: s.smtpConfigured, activeProvider: s.isConfigured ? 'Email is on' : 'Email is not set up', senderFrom: '', userEmail: '' } };
    }
    if (r.action !== 'send' && r.action !== 'test') return fail(404, 'Unknown email action.');
    if (r.method !== 'POST') return fail(405, 'Method not allowed.');
    if (!c.companyId) return fail(403, 'Open this as a company user.');
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    return r.action === 'send' ? await send(c, b) : await test(c);
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return known;
    console.error('[email] error:', err);
    return fail(500, 'The email request failed.');
  }
}
