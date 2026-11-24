/** Small shared helpers for the workplace routers (e-sign, engagement, assets, configuration builders, projects). */
import { requireActiveTenant, type AuthContext } from './authContext.js';
import { hasPerm } from '../../shared/permissions.js';
import { LeaveError, db, loadPeople, nowIso, str, type Person } from './leaveCore.js';

export interface Result { status: number; json: any }
export const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
export const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });
export class WorkError extends Error { constructor(public status: number, message: string) { super(message); } }
export const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export interface WorkReq { method: string; action: string; query: Record<string, any>; body: any; headers: Record<string, any>; ip?: string }
export interface Who { ctx: AuthContext; cid: string; uid: string; name: string; email: string; admin: boolean; can: (perm: string) => boolean }

export async function whoIs(headers: Record<string, any>): Promise<Who> {
  const ctx = await requireActiveTenant(headers);
  if (!ctx.companyId) throw new LeaveError(403, 'Open this as a company user.');
  const people = await loadPeople(ctx.companyId);
  const me = people.find((p) => p.uid === ctx.uid);
  return {
    ctx, cid: ctx.companyId, uid: ctx.uid, name: me?.name || ctx.email || 'Someone', email: (me?.email || ctx.email || '').toLowerCase(),
    admin: ctx.isCompanyAdmin, can: (perm) => ctx.isCompanyAdmin || hasPerm(ctx.perms, perm),
  };
}

export const need = (who: Who, perm: string, msg = 'You do not have access to this.') => { if (!who.can(perm)) throw new WorkError(403, msg); };
export const needAny = (who: Who, perms: string[], msg = 'You do not have access to this.') => { if (!perms.some((p) => who.can(p))) throw new WorkError(403, msg); };

/** Numbers in request bodies: finite, within bounds. */
export function numIn(v: unknown, label: string, min: number, max: number, dflt?: number): number {
  if ((v === undefined || v === null || v === '') && dflt !== undefined) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new WorkError(400, `${label} must be a number between ${min} and ${max}.`);
  return n;
}
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
export const dayOr = (v: unknown, label: string, optional = false): string => {
  const s = str(v, 10);
  if (!s && optional) return '';
  if (!isDay(s)) throw new WorkError(400, `${label} must be a valid date.`);
  return s;
};
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export async function peopleMap(cid: string): Promise<Map<string, Person>> {
  return new Map((await loadPeople(cid)).map((p) => [p.uid, p]));
}

/** Runs a router action and turns WorkError / auth errors into results. */
export async function guarded(fn: () => Promise<Result | undefined>, authErr: (e: unknown) => { status: number; json: any } | null): Promise<Result | undefined> {
  try { return await fn(); } catch (err: any) {
    if (err instanceof WorkError) return fail(err.status, err.message);
    if (err instanceof LeaveError) return fail(err.status, err.message);
    const known = authErr(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Workplace] error:', err);
    return fail(500, err?.message || 'Request failed.');
  }
}

export { db, nowIso, str };
