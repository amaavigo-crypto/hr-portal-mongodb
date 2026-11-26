/**
 * Founders Dashboard feed.
 *
 *   GET /api/founder/metrics     Authorization: Bearer <FOUNDER_METRICS_KEY>
 *
 * The dashboard calls this once a day and stores the answer as that day's snapshot. It never reads our database.
 * Read-only, counts only (see shared/founderMetrics.ts for exactly what is returned and why).
 *
 * Set FOUNDER_METRICS_KEY (24+ random characters) in .env, and paste the same value into the dashboard when you
 * add this project there. Without it the endpoint answers 503 and gives nothing away.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { MODULES } from '../../shared/permissions.js';
import { buildMetrics, type FounderActivity, type FounderCompany, type FounderEmployee } from '../../shared/founderMetrics.js';

interface Result { status: number; json: any }

/** A short cache keeps the answer well under the dashboard's 2 second limit and the database quiet if it is called often. */
const CACHE_MS = 5 * 60_000;
let cache: { at: number; json: any } | null = null;
export const __resetFounderCache = () => { cache = null; };

const header = (headers: Record<string, any> | undefined, name: string): string => {
  const v = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(v) ? String(v[0] || '') : String(v || '');
};
const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time comparison (hashing first so the length of the key cannot be guessed either). */
export function keyMatches(given: string, key: string): boolean {
  return key.length >= 24 && timingSafeEqual(digest(given), digest(key));
}

/** `select` keeps big fields (photos, documents) out of the read; the in-memory test database has no `select`. */
const slim = (q: any, ...fields: string[]) => (typeof q.select === 'function' ? q.select(...fields) : q);

async function load() {
  const db = adminDb();
  const [companies, employees, activity] = await Promise.all([
    slim(db.collection('companies'), 'name', 'status', 'plan', 'modules', 'createdAt', 'approvedAt', 'updatedAt').get(),
    slim(db.collection('employees'), 'companyId', 'active').get(),
    slim(db.collection('userActivity'), 'uid', 'companyId', 'firstSeenAt', 'lastSeenAt').get(),
  ]);
  return {
    companies: companies.docs.map((d: any): FounderCompany => {
      const x = d.data() || {};
      return {
        id: d.id, name: String(x.name || ''), status: String(x.status || ''), plan: String(x.plan || ''),
        modules: Array.isArray(x.modules) ? x.modules.map(String) : [],
        createdAt: x.createdAt, approvedAt: x.approvedAt, updatedAt: x.updatedAt,
      };
    }),
    employees: employees.docs.map((d: any): FounderEmployee => {
      const x = d.data() || {};
      return { companyId: String(x.companyId || ''), active: x.active };
    }),
    activity: activity.docs.map((d: any): FounderActivity => {
      const x = d.data() || {};
      return { uid: String(x.uid || d.id), companyId: String(x.companyId || ''), firstSeenAt: x.firstSeenAt, lastSeenAt: x.lastSeenAt };
    }),
  };
}

export async function founderMetrics(headers: Record<string, any> | undefined, now: Date = new Date()): Promise<Result> {
  const key = (process.env.FOUNDER_METRICS_KEY || '').trim();
  if (key.length < 24) return { status: 503, json: { error: 'The Founders Dashboard feed is not set up on this server.' } };
  const given = header(headers, 'authorization').replace(/^Bearer\s+/i, '').trim();
  if (!keyMatches(given, key)) return { status: 401, json: { error: 'unauthorized' } };

  if (cache && now.getTime() - cache.at < CACHE_MS) return { status: 200, json: cache.json };
  const rows = await load();
  const moduleLabels = Object.fromEntries(MODULES.map((m) => [m.key, m.label]));
  const json = buildMetrics({ now, ...rows, moduleLabels });
  cache = { at: now.getTime(), json };
  return { status: 200, json };
}
