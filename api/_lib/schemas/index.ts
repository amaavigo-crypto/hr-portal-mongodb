/**
 * The database schema registry and the write validator used by the MongoDB adapter.
 *
 * Mode (environment variable SCHEMA_VALIDATION):
 *   warn     (default)  a write that breaks a schema is saved anyway and logged once per collection and field
 *   enforce             a write that breaks a schema is refused with an error (code SCHEMA_INVALID)
 *   off                 no validation at all
 *
 * Start in `warn`, look at the logs for a while, fix the code or the schema where they disagree, then switch to `enforce`.
 * Fields a schema does not mention are always allowed (schemas are `strict: false`).
 */
import mongoose, { type Model } from 'mongoose';
import type { Def, IndexSpec } from './helpers.js';
import { core } from './core.js';
import { accounts } from './accounts.js';
import { documents } from './documents.js';
import { employee } from './employee.js';
import { leave } from './leave.js';
import { payroll } from './payroll.js';
import { hiring } from './hiring.js';
import { people } from './people.js';
import { workplace } from './workplace.js';

export { HIRING_KINDS, HRBP_KINDS } from './hiring.js';

export const SCHEMAS: Record<string, Def> = { ...core, ...accounts, ...documents, ...employee, ...leave, ...payroll, ...hiring, ...people, ...workplace };

export type ValidationMode = 'off' | 'warn' | 'enforce';
export function validationMode(): ValidationMode {
  const v = (process.env.SCHEMA_VALIDATION || 'warn').trim().toLowerCase();
  return v === 'off' || v === 'enforce' ? v : 'warn';
}

// ---------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------

const models = new Map<string, Model<any>>();
const modelFor = (key: string, schema: mongoose.Schema): Model<any> => {
  let m = models.get(key);
  if (!m) {
    // A private model name per schema; nothing ever connects, so this never touches the database.
    m = mongoose.models[`hrp_${key}`] || mongoose.model(`hrp_${key}`, schema, `hrp_${key}`);
    models.set(key, m);
  }
  return m;
};

export interface SchemaProblem { path: string; message: string }

/** Drops FieldValue sentinels (increment, arrayUnion, delete ...): they are operations, not values. */
function plain(v: any): any {
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (typeof v.kind === 'string' && 'arg' in v && Object.getPrototypeOf(v) !== Object.prototype) return undefined; // MongoFieldValue
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return v;
    const out: Record<string, any> = {};
    for (const [k, x] of Object.entries(v)) {
      const p = plain(x);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  return v;
}

async function check(key: string, schema: mongoose.Schema, data: Record<string, any>, paths?: string[]): Promise<SchemaProblem[]> {
  const doc = new (modelFor(key, schema))(data);
  try {
    await doc.validate(paths);
    return [];
  } catch (err: any) {
    if (!err?.errors) throw err;
    return Object.values(err.errors).map((e: any) => ({ path: String(e.path), message: String(e.message) }));
  }
}

/**
 * Validates a document about to be written.
 *  - `full`: the whole document (create, or set without merge): required fields must be present
 *  - `partial`: only some fields (update, set with merge): only the named top-level fields are checked
 */
export async function validateDoc(collection: string, data: Record<string, any>, mode: 'full' | 'partial'): Promise<SchemaProblem[]> {
  const def = SCHEMAS[collection];
  if (!def) return [];
  const body = plain(data) || {};
  let fields: string[] | undefined;
  if (mode === 'partial') {
    // Dotted keys ("a.b") change one nested value of a field we cannot see whole, so they are not checked.
    fields = Object.keys(body).filter((k) => !k.includes('.'));
    if (fields.length === 0) return [];
  }
  const problems = await check(collection, def.schema, body, fields);
  const kind = body.kind;
  const extra = def.kinds && typeof kind === 'string' ? def.kinds[kind] : undefined;
  if (extra && mode === 'full') problems.push(...(await check(`${collection}.${kind}`, extra, body)));
  return problems;
}

const reported = new Set<string>();

/** Called by the adapter before every write. Throws only in `enforce` mode. */
export async function checkWrite(collection: string, id: string, data: Record<string, any>, mode: 'full' | 'partial'): Promise<void> {
  const level = validationMode();
  if (level === 'off') return;
  let problems: SchemaProblem[];
  try {
    problems = await validateDoc(collection, data, mode);
  } catch (e) {
    // A schema bug must never take writes down.
    if (level === 'enforce') throw e;
    return;
  }
  if (problems.length === 0) return;
  if (level === 'enforce') {
    throw Object.assign(new Error(`Schema check failed for ${collection}/${id}: ${problems.map((p) => `${p.path}: ${p.message}`).join('; ')}`), { code: 'SCHEMA_INVALID', problems });
  }
  for (const p of problems) {
    const k = `${collection}:${p.path}`;
    if (reported.has(k)) continue;
    reported.add(k);
    console.warn(`[schema] ${collection}/${id} ${p.path}: ${p.message}`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------------------------------------

/** The indexes a collection should have: `companyId` first (every query filters on it), then those in its schema. Never unique. */
export function indexesFor(collection: string): IndexSpec[] {
  const def = SCHEMAS[collection];
  // Account-level collections (accounts, transferRequests ...) have no companyId, so they get no companyId index.
  const out: IndexSpec[] = !def || def.schema.path('companyId') ? [[{ companyId: 1 }, { name: 'companyId_1' }]] : [];
  if (!def) return out;
  for (const [fields, options] of def.schema.indexes() as any[]) {
    const keys = Object.keys(fields);
    if (keys.length === 1 && keys[0] === 'companyId') continue;
    out.push([fields, { ...options, name: keys.map((k) => `${k}_${fields[k]}`).join('_') }]);
  }
  return out;
}
