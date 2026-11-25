/**
 * Attendance-log ingestion. Two ways in:
 *
 *   POST /api/leave/attendance-ingest   a device, gateway or script sends punches with a company API key
 *                                       (header  x-api-key: atk_...). JSON: { logs: [{ empId, time, direction? }] }
 *   POST /api/leave/attendance-import   HR uploads a CSV export (needs leave.manage). JSON: { csv: "..." }
 *   GET  attendance-keys / POST create-attendance-key / revoke-attendance-key   manage the keys (leave.manage)
 *
 *   attendanceApiKeys/{sha256 of the key}   one key: label, prefix, active, lastUsedAt. The key itself is shown once.
 *
 * Punches become the same `leaveAttendance` days the self check-in writes, so reports, regularisation and payroll
 * attendance inputs see them with no other change. Existing punches are kept; sending a log twice changes nothing.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db, loadPeople, nowIso, str } from './leaveCore.js';
import { dayFields, groupPunches, mergePunches, parseCsv, parseJson, type Parsed } from '../../shared/attendanceIngest.js';
import { sessionsOf } from '../../shared/leaveEngine.js';

interface Result { status: number; json: any }
const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
const attendanceId = (cid: string, uid: string, date: string) => `${cid}__${uid}__${date}`;

/** Days older than this, or more than a day ahead, are refused so a bad device clock cannot rewrite history. */
const MAX_AGE_DAYS = 62;

/** Apply parsed punches for one company. */
export async function applyPunches(cid: string, parsed: Parsed, source: 'DEVICE' | 'IMPORT') {
  const people = (await loadPeople(cid)).filter((p) => p.active && p.empId);
  const byEmp = new Map(people.map((p) => [p.empId.trim().toLowerCase(), p]));
  const grouped = groupPunches(parsed.punches);
  const now = Date.now();
  const earliest = new Date(now + 5.5 * 3600_000 - MAX_AGE_DAYS * 86400_000).toISOString().slice(0, 10);
  const latest = new Date(now + 5.5 * 3600_000 + 86400_000).toISOString().slice(0, 10);

  const unknown: string[] = [];
  const problems = [...parsed.problems];
  const jobs: { uid: string; date: string; punches: { at: string; dir: any }[] }[] = [];
  let outOfRange = 0;
  for (const [emp, days] of grouped) {
    const person = byEmp.get(emp);
    if (!person) { if (unknown.length < 50) unknown.push(emp); continue; }
    for (const [date, punches] of days) {
      if (date < earliest || date > latest) { outOfRange += punches.length; continue; }
      jobs.push({ uid: person.uid, date, punches });
    }
  }
  if (outOfRange) problems.push(`${outOfRange} punches were skipped because their date is more than ${MAX_AGE_DAYS} days old or in the future.`);

  let daysUpdated = 0, added = 0, ignored = 0;
  for (let i = 0; i < jobs.length; i += 25) {
    await Promise.all(jobs.slice(i, i + 25).map(async (j) => {
      const ref = db().collection('leaveAttendance').doc(attendanceId(cid, j.uid, j.date));
      const snap = await ref.get();
      const rec: any = snap.exists ? snap.data() : null;
      const r = mergePunches(sessionsOf(rec), j.punches);
      added += r.added; ignored += r.ignored;
      if (!r.added) return;
      daysUpdated++;
      await ref.set({
        companyId: cid, uid: j.uid, date: j.date, month: j.date.slice(0, 7), sessions: r.sessions, ...dayFields(r.sessions),
        source: rec?.source || source, ip: rec?.ip || '', inNote: rec?.inNote || '', outNote: rec?.outNote || '', updatedAt: nowIso(),
      });
    }));
  }
  return { received: parsed.punches.length, added, ignored, daysUpdated, unknownEmployees: unknown, problems };
}

/** Looks up the company a key belongs to; undefined when it is missing or revoked. */
async function companyOfKey(key: string): Promise<{ cid: string; id: string } | undefined> {
  if (!/^atk_[a-f0-9]{48}$/.test(key)) return undefined;
  const id = hashKey(key);
  const snap = await db().collection('attendanceApiKeys').doc(id).get();
  const d: any = snap.exists ? snap.data() : null;
  if (!d || d.active === false || !d.companyId) return undefined;
  return { cid: d.companyId, id };
}

/** Device endpoint: authenticated by the API key header only. */
export async function ingestWithKey(headers: Record<string, any>, body: any): Promise<Result> {
  const key = str(headers['x-api-key'] ?? headers['X-Api-Key'], 80);
  const owner = await companyOfKey(key);
  if (!owner) return fail(401, 'Invalid or revoked API key.');
  const parsed = parseJson(body?.logs);
  if (!parsed.punches.length) return fail(400, parsed.problems[0] || 'No valid punches were sent.');
  const result = await applyPunches(owner.cid, parsed, 'DEVICE');
  await db().collection('attendanceApiKeys').doc(owner.id).set({ lastUsedAt: nowIso() }, { merge: true });
  return ok(result);
}

export async function importCsv(cid: string, body: any): Promise<Result> {
  const csv = typeof body?.csv === 'string' ? body.csv : '';
  if (!csv.trim()) return fail(400, 'Paste or upload the CSV first.');
  if (csv.length > 5_000_000) return fail(400, 'The file is too large. Split it by month.');
  const parsed = parseCsv(csv);
  if (!parsed.punches.length) return fail(400, parsed.problems[0] || 'No valid rows were found.');
  return ok(await applyPunches(cid, parsed, 'IMPORT'));
}

export async function listKeys(cid: string): Promise<Result> {
  const snap = await db().collection('attendanceApiKeys').where('companyId', '==', cid).get();
  const items = snap.docs.map((d: any) => { const x = d.data(); return { id: d.id, label: x.label, prefix: x.prefix, active: x.active !== false, createdAt: x.createdAt, lastUsedAt: x.lastUsedAt || '' }; })
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return ok({ items });
}

export async function createKey(cid: string, byUid: string, body: any): Promise<Result> {
  const label = str(body?.label, 60);
  if (!label) return fail(400, 'Give the key a name, for example the device or the site.');
  const existing = await db().collection('attendanceApiKeys').where('companyId', '==', cid).get();
  if (existing.docs.filter((d: any) => d.data().active !== false).length >= 10) return fail(409, 'You can have at most 10 active keys. Revoke one first.');
  const key = `atk_${randomBytes(24).toString('hex')}`;
  await db().collection('attendanceApiKeys').doc(hashKey(key)).set({ companyId: cid, label, prefix: key.slice(0, 8), active: true, createdBy: byUid, createdAt: nowIso() });
  return ok({ key, note: 'Copy this key now. It is not shown again.' });
}

export async function revokeKey(cid: string, body: any): Promise<Result> {
  const id = str(body?.id, 80);
  const ref = db().collection('attendanceApiKeys').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as any).companyId !== cid) return fail(404, 'Key not found.');
  await ref.set({ active: false, revokedAt: nowIso() }, { merge: true });
  return ok({ revoked: true });
}
