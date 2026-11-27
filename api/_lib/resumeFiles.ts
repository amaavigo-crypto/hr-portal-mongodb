/**
 * Resume files uploaded on a company's public careers page. They are kept in the database (collection resumeFiles, in
 * parts small enough for one record) rather than on one server's disk, and are opened with a signed link that cannot be
 * guessed. Only the signed link for a file opens that file.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { signStorageToken } from './storageToken.js';

const PART_CHARS = 700_000;
const PATH = '/api/recruitment/careers-resume-file';

export interface StoredResume { buf: Buffer; name: string; mime: string; companyId: string }

export async function saveResumeFile(companyId: string, applicationId: string, name: string, mime: string, buf: Buffer): Promise<string> {
  const fileId = randomBytes(16).toString('hex');
  const data = buf.toString('base64');
  const parts = Math.ceil(data.length / PART_CHARS);
  for (let i = 0; i < parts; i++) {
    await adminDb().collection('resumeFiles').doc(`${fileId}_${i}`).set({ companyId, applicationId, fileId, part: i, parts, name, mime, data: data.slice(i * PART_CHARS, (i + 1) * PART_CHARS), createdAt: new Date().toISOString() });
  }
  return `${PATH}?f=${fileId}&t=${signStorageToken(`resume:${fileId}`)}`;
}

export function validResumeToken(fileId: string, token: string): boolean {
  if (!/^[a-f0-9]{32}$/.test(fileId) || typeof token !== 'string') return false;
  const expected = Buffer.from(signStorageToken(`resume:${fileId}`));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function readResumeFile(fileId: string): Promise<StoredResume | null> {
  const ref = (i: number) => adminDb().collection('resumeFiles').doc(`${fileId}_${i}`);
  const first = await ref(0).get();
  if (!first.exists) return null;
  const head = first.data() as any;
  let data = String(head.data || '');
  for (let i = 1; i < Number(head.parts || 1); i++) {
    const s = await ref(i).get();
    if (!s.exists) return null;
    data += String(s.get('data') || '');
  }
  return { buf: Buffer.from(data, 'base64'), name: String(head.name || 'resume'), mime: String(head.mime || 'application/octet-stream'), companyId: String(head.companyId || '') };
}

/** The file behind a stored-resume link, or null when the link is not one of ours (or its signature is wrong). */
export async function loadStoredResume(url: string): Promise<StoredResume | null> {
  if (!String(url || '').startsWith(`${PATH}?`)) return null;
  const q = new URLSearchParams(url.slice(PATH.length + 1));
  const f = q.get('f') || '';
  return validResumeToken(f, q.get('t') || '') ? readResumeFile(f) : null;
}

export async function deleteResumeFiles(companyId: string, applicationId: string): Promise<void> {
  const snap = await adminDb().collection('resumeFiles').where('companyId', '==', companyId).where('applicationId', '==', applicationId).get();
  for (const d of snap.docs) await d.ref.delete();
}
