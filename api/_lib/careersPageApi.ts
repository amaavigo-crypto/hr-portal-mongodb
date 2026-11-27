/**
 * A company's own public careers page (reached through hiringRouter.ts as /api/recruitment/careers-<action>):
 *
 *   careers-state / careers-save           hiring managers: set up, publish or unpublish; applications by link
 *   careers-public-get                     anyone: the published page and its open jobs
 *   careers-public-apply                   anyone: apply, with a resume file
 *   careers-resume-file                    a signed link that opens one uploaded resume
 *
 * Off until a hiring manager publishes it. The public routes return only what the page shows (never salary bands or
 * anything about other applicants), always answer a repeat application the same way as a new one, and are limited by
 * address and per company per day. The company is decided by the page's own address, never by the request.
 */
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { createApplication, listApplications, normalizeApplicationInput, rateLimited } from './recruitmentData.js';
import { MANAGE_PERMS, getItem, listItems, newId, putItem, whoIs, type Item, type PipeRequest } from './pipelineApi.js';
import { signStorageToken } from './storageToken.js';
import { readResumeFile, saveResumeFile, validResumeToken } from './resumeFiles.js';
import { textFromResumeBuffer } from './aiScoring.js';
import { DEFAULT_SOURCE, MAX_RESUME_BYTES, RETENTION_CHOICES, consentText, toSlug, toSourceLabel } from '../../shared/careers.js';

type Res = { status: number; json: any };
const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const ok = (extra: Record<string, any> = {}): Res => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string): Res => ({ status, json: { success: false, error } });

export const DAILY_APPLICATION_LIMIT = 300;
const MIN_FILL_MS = 3000;
const FORM_VALID_MS = 24 * 3600_000;

let nowMs = () => Date.now();
export const __setCareersNow = (fn: (() => number) | null) => { nowMs = fn || (() => Date.now()); };

const canManage = (ctx: AuthContext) => ctx.isCompanyAdmin || MANAGE_PERMS.some((p) => ctx.perms.includes(p));
const pageId = (cid: string) => `careers_${cid}`;

interface Page { published: boolean; slug: string; headline: string; intro: string; retentionMonths: number; hiddenJobs: string[]; updatedBy?: string; updatedAt?: string }

async function companyDoc(cid: string): Promise<{ name: string; logo: string; active: boolean }> {
  const s = await db().collection('companies').doc(cid).get();
  const d: any = s.exists ? s.data() : {};
  const logo = str(d.logoUrl || d.logo, 300_000);
  return { name: str(d.name, 120) || 'Our company', logo: /^(https:\/\/|data:image\/(png|jpe?g|webp|gif);base64,|\/api\/)/i.test(logo) ? logo : '', active: d.status === 'ACTIVE' && (!Array.isArray(d.modules) || d.modules.includes('talent-acquisition')) };
}

async function getPage(cid: string): Promise<Page> {
  const it = await getItem(cid, pageId(cid), 'careersPage');
  if (it) return it as unknown as Page;
  return { published: false, slug: toSlug((await companyDoc(cid)).name) || 'careers', headline: '', intro: '', retentionMonths: 12, hiddenJobs: [] };
}

async function openJobs(cid: string) {
  const snap = await db().collection('requisitions').where('companyId', '==', cid).where('status', '==', 'JOB_OPEN').get();
  return snap.docs.map((d: any) => {
    const r = d.data() as any;
    const min = Number(r.minExperienceYears), max = Number(r.maxExperienceYears);
    return {
      id: String(r.id || d.id), title: str(r.positionTitle, 120), department: str(r.departmentName, 120), location: str(r.location, 120),
      employmentType: str(r.employmentType, 40), workMode: str(r.workMode, 20), experience: max > 0 ? `${min || 0}–${max} years` : '',
      description: String(r.jd?.text || '').slice(0, 20_000),
    };
  }).filter((j: any) => j.title).sort((a: any, b: any) => a.title.localeCompare(b.title));
}

async function slugOwner(slug: string): Promise<Item | null> {
  const snap = await db().collection('hiringItems').where('kind', '==', 'careersPage').where('slug', '==', slug).get();
  return snap.docs.length ? (snap.docs[0].data() as Item) : null;
}

async function stateRoute(cid: string): Promise<Res> {
  const [page, jobs, apps, company] = await Promise.all([getPage(cid), openJobs(cid), listApplications(cid), companyDoc(cid)]);
  const mine = apps.filter((a) => a.source === 'CAREERS');
  const cutoff = new Date(nowMs()); cutoff.setUTCMonth(cutoff.getUTCMonth() - page.retentionMonths);
  return ok({
    page, companyName: company.name,
    jobs: jobs.map((j: any) => {
      const bySource: Record<string, number> = {};
      for (const a of mine) if (a.requisitionId === j.id) bySource[a.sourceLabel || DEFAULT_SOURCE] = (bySource[a.sourceLabel || DEFAULT_SOURCE] || 0) + 1;
      return { ...j, hidden: page.hiddenJobs.includes(j.id), bySource };
    }),
    total: mine.length,
    pastRetention: mine.filter((a) => a.createdAt < cutoff.toISOString()).map((a) => ({ id: a.id, name: a.name, designation: a.designation, createdAt: a.createdAt })).slice(0, 100),
  });
}

async function saveRoute(ctx: AuthContext, b: any): Promise<Res> {
  const cid = ctx.companyId!;
  const prev = await getPage(cid);
  const slug = b.slug === undefined ? prev.slug : toSlug(b.slug);
  if (slug.length < 3) return fail(400, 'The page address needs at least 3 letters or numbers.');
  const owner = await slugOwner(slug);
  if (owner && owner.companyId !== cid) return fail(409, 'That page address is already taken. Choose another.');
  const months = b.retentionMonths === undefined ? prev.retentionMonths : Number(b.retentionMonths);
  if (!(RETENTION_CHOICES as readonly number[]).includes(months)) return fail(400, 'Choose how long applications are kept.');
  const next: Page = {
    published: typeof b.published === 'boolean' ? b.published : prev.published, slug,
    headline: b.headline === undefined ? prev.headline : str(b.headline, 120), intro: b.intro === undefined ? prev.intro : str(b.intro, 1500),
    retentionMonths: months, hiddenJobs: Array.isArray(b.hiddenJobs) ? b.hiddenJobs.map((x: unknown) => str(x, 200)).filter(Boolean).slice(0, 500) : prev.hiddenJobs,
    updatedBy: await whoIs(ctx), updatedAt: nowIso(),
  };
  await putItem({ ...next, id: pageId(cid), companyId: cid, kind: 'careersPage' });
  return stateRoute(cid);
}

// ------------------------------------------------------------------ public

/** The published page behind an address, or null. Unpublished pages and inactive companies look exactly like no page. */
async function publishedPage(slugIn: unknown) {
  const slug = str(slugIn, 60);
  if (!slug || slug !== toSlug(slug)) return null;
  const it = await slugOwner(slug);
  if (!it || !it.published) return null;
  const company = await companyDoc(it.companyId);
  return company.active ? { page: it as unknown as Page, cid: it.companyId, company } : null;
}

const formToken = (slug: string, at: number) => `${at}.${signStorageToken(`careers:${slug}:${at}`)}`;
function formAge(slug: string, token: string): number | null {
  const [at, sig] = token.split('.');
  return /^\d+$/.test(at || '') && sig === signStorageToken(`careers:${slug}:${at}`) ? nowMs() - Number(at) : null;
}

/** The address the nearest proxy saw. Anything earlier in x-forwarded-for was typed by the caller. */
const clientIp = (h: Record<string, any>) => String(h?.['x-real-ip'] || String(h?.['x-forwarded-for'] || '').split(',').pop() || '').trim() || 'unknown';

async function publicGet(r: PipeRequest): Promise<Res> {
  if (rateLimited(`careers-get:${clientIp(r.headers)}`, 60)) return fail(429, 'Too many requests. Please try again in a minute.');
  const hit = await publishedPage(r.query?.slug);
  if (!hit) return fail(404, 'This careers page is not available.');
  const jobs = (await openJobs(hit.cid)).filter((j: any) => !hit.page.hiddenJobs.includes(j.id));
  return ok({
    companyName: hit.company.name, logo: hit.company.logo, headline: hit.page.headline, intro: hit.page.intro, jobs,
    consent: consentText(hit.company.name, hit.page.retentionMonths), formToken: formToken(hit.page.slug, nowMs()),
  });
}

function resumeKind(buf: Buffer, name: string): { mime: string; ext: string } | null {
  if (/\.pdf$/i.test(name) && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  // A .docx is a zip file that contains a word/ folder; its file names are readable without unpacking.
  if (/\.docx$/i.test(name) && buf[0] === 0x50 && buf[1] === 0x4b && buf.includes('word/')) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
  return null;
}

async function takeDailyQuota(cid: string): Promise<boolean> {
  const day = new Date(nowMs()).toISOString().slice(0, 10);
  const ref = db().collection('hiringItems').doc(`careersquota_${cid}_${day}`);
  let allowed = false;
  await db().runTransaction(async (tx: any) => {
    const s = await tx.get(ref);
    const used = s.exists ? Number(s.get('used') || 0) : 0;
    allowed = used < DAILY_APPLICATION_LIMIT;
    if (allowed) tx.set(ref, { id: ref.id, companyId: cid, kind: 'careersQuota', used: used + 1 });
  });
  return allowed;
}

const received = () => ok({ message: 'Thank you. Your application has been received.' });

async function publicApply(r: PipeRequest): Promise<Res> {
  const ip = clientIp(r.headers);
  if (rateLimited(`careers-apply:${ip}`, 5) || rateLimited(`careers-apply-hour:${ip}`, 20, 3600_000)) return fail(429, 'Too many applications from this connection. Please try again later.');
  const b = r.body && typeof r.body === 'object' ? r.body : {};
  const hit = await publishedPage(b.slug);
  if (!hit) return fail(404, 'This careers page is not available.');
  // The hidden "website" box is invisible to people; only form-filling robots complete it. They are told it worked.
  if (str(b.website)) return received();
  const age = formAge(hit.page.slug, str(b.formToken, 200));
  if (age === null || age > FORM_VALID_MS) return fail(400, 'This page has been open for a long time. Please reload it and apply again.');
  if (age < MIN_FILL_MS) return fail(400, 'That was very quick. Please wait a few seconds and press Submit again.');
  const job = (await openJobs(hit.cid)).find((j: any) => j.id === str(b.jobId, 200) && !hit.page.hiddenJobs.includes(j.id));
  if (!job) return fail(409, 'This role is no longer open.');
  if (b.consent !== true) return fail(400, 'Please tick the consent box to apply.');
  const phone = str(b.phone, 30);
  if (phone.replace(/\D/g, '').length < 7) return fail(400, 'Enter a phone number.');
  const salary = Number(b.expectedCtcLpa);
  if (!(salary > 0 && salary <= 1000)) return fail(400, 'Enter your expected salary in lakhs per year.');
  const { value, error } = normalizeApplicationInput({ name: str(b.name, 120), email: str(b.email, 200), mobile: phone, designation: job.title, requisition_id: job.id });
  if (!value) return fail(400, error || 'Check your details.');
  value.requisitionId = job.id;

  const fileName = str(b.resume?.name, 150).replace(/[^A-Za-z0-9._ -]/g, '_');
  const data = typeof b.resume?.data === 'string' ? b.resume.data : '';
  if (!fileName || !data) return fail(400, 'Attach your resume as a PDF or Word (.docx) file.');
  if (data.length > Math.ceil(MAX_RESUME_BYTES / 3) * 4 + 4) return fail(413, 'The resume must be 5 MB or smaller.');
  const buf = Buffer.from(data, 'base64');
  if (buf.length > MAX_RESUME_BYTES) return fail(413, 'The resume must be 5 MB or smaller.');
  const kind = resumeKind(buf, fileName);
  if (!kind) return fail(400, 'The resume must be a real PDF or Word (.docx) file.');
  if (!(await takeDailyQuota(hit.cid))) return fail(429, 'We cannot take more applications today. Please try again tomorrow.');

  await createApplication(hit.cid, value, 'CAREERS', {
    protectExisting: true,
    fields: { sourceLabel: toSourceLabel(b.source), expectedCtcLpa: salary, consent: { at: nowIso(), text: consentText(hit.company.name, hit.page.retentionMonths), retentionMonths: hit.page.retentionMonths } },
    prepare: async (id) => {
      const resumeUrl = await saveResumeFile(hit.cid, id, fileName, kind.mime, buf);
      const read = await textFromResumeBuffer(buf);
      if (read.text) await putItem({ id: newId(), companyId: hit.cid, kind: 'resume', applicationId: id, text: read.text.slice(0, 20_000), facts: {}, extractedAt: nowIso() });
      return { resumeUrl };
    },
  });
  // The same answer for a repeat application, so the form cannot be used to find out who has applied.
  return received();
}

async function resumeFile(r: PipeRequest): Promise<Res> {
  const f = str(r.query?.f, 40);
  if (!validResumeToken(f, str(r.query?.t, 80))) return fail(403, 'Invalid or missing file link.');
  const file = await readResumeFile(f);
  if (!file) return fail(404, 'This file is no longer available.');
  return { status: 200, json: { __file: { base64: file.buf.toString('base64'), name: file.name, mime: file.mime } } };
}

export async function routeCareersPage(r: PipeRequest): Promise<Res | null> {
  const method = ({ 'careers-state': 'GET', 'careers-save': 'POST', 'careers-public-get': 'GET', 'careers-public-apply': 'POST', 'careers-resume-file': 'GET' } as Record<string, string>)[r.action];
  if (!method) return null;
  try {
    if (r.method !== method) return fail(405, 'Method not allowed.');
    if (r.action === 'careers-public-get') return await publicGet(r);
    if (r.action === 'careers-public-apply') return await publicApply(r);
    if (r.action === 'careers-resume-file') return await resumeFile(r);
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (!canManage(ctx)) return fail(403, 'Only the people who manage hiring can change the careers page.');
    return r.action === 'careers-state' ? await stateRoute(ctx.companyId) : await saveRoute(ctx, r.body && typeof r.body === 'object' ? r.body : {});
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return known;
    console.error('[Careers] error:', err);
    return fail(500, 'Something went wrong. Please try again.');
  }
}
