/**
 * Group administrators and the organisation switcher.
 *
 * A group administrator belongs to one organisation (their employee record) and may act as administrator in every
 * organisation of their account. Switching rewrites their sign-in claims (cid) to the chosen organisation. The server
 * checks every switch against the account in the database, never only against the token, so a removed group
 * administrator cannot switch again.
 */
import { adminAuth, adminDb } from './firebaseAdmin.js';
import { authenticate, requirePlatformAdmin, AuthError, type AuthContext } from './authContext.js';
import type { TenantClaims } from '../../shared/permissions.js';
import type { AccountDoc } from './accounts.js';

export interface OrgResult { status: number; json: any }
export interface OrgDeps { syncUser: (uid: string, preloaded?: any) => Promise<void> }

const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const ok = (extra: Record<string, unknown> = {}): OrgResult => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string): OrgResult => ({ status, json: { success: false, error } });
const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);

export async function loadAccount(accountId: string | null | undefined): Promise<AccountDoc | null> {
  if (!accountId) return null;
  const snap = await db().collection('accounts').doc(accountId).get();
  return snap.exists ? (snap.data() as AccountDoc) : null;
}

/** The organisation the person's employee record lives in. */
export async function homeCompanyOf(uid: string): Promise<string | null> {
  const direct = await db().collection('employees').doc(uid).get();
  if (direct.exists) return String((direct.data() as any).companyId || '') || null;
  const q = await db().collection('employees').where('authUid', '==', uid).limit(1).get();
  return q.empty ? null : String((q.docs[0].data() as any).companyId || '') || null;
}

/** Signed in as a group administrator of an account that still lists them (checked in the database, not just the token). */
export async function requireGroupAdmin(headers: Record<string, any> | undefined): Promise<{ ctx: AuthContext; account: AccountDoc }> {
  const ctx = await authenticate(headers);
  if (!ctx.isGroupAdmin || !ctx.accountId) throw new AuthError(403, 'Group administrators only.');
  const account = await loadAccount(ctx.accountId);
  if (!account || !(account.groupAdminUids || []).includes(ctx.uid)) throw new AuthError(403, 'You are no longer a group administrator of this account.');
  return { ctx, account };
}

async function audit(accountId: string, action: string, by: string, details: Record<string, unknown>) {
  const id = `aa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await db().collection('accountAudit').doc(id).set({ id, accountId, action, by, at: nowIso(), ...details });
}

async function myOrganisations(headers: Record<string, any>): Promise<OrgResult> {
  const { ctx, account } = await requireGroupAdmin(headers);
  const snap = await db().collection('companies').where('accountId', '==', account.id).get();
  const organisations = snap.docs
    .map((d: any) => d.data() as any)
    .map((c: any) => ({ id: c.id, name: c.name, status: c.status, current: c.id === ctx.companyId, home: c.id === ctx.homeCompanyId }))
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  return ok({ account: { id: account.id, name: account.name, orgLimit: account.orgLimit }, organisations });
}

async function switchOrganisation(headers: Record<string, any>, body: any, deps: OrgDeps): Promise<OrgResult> {
  const { ctx, account } = await requireGroupAdmin(headers);
  const companyId = str(body.companyId, 128);
  const target = await db().collection('companies').doc(companyId).get();
  if (!companyId || !target.exists) return fail(404, 'Organisation not found.');
  const company = target.data() as any;
  if (company.accountId !== account.id) return fail(403, 'That organisation does not belong to your account.');

  const home = await homeCompanyOf(ctx.uid);
  if (!home) return fail(409, 'Your own employee record could not be found, so there is no home organisation to return to.');

  if (companyId === home) {
    await deps.syncUser(ctx.uid); // back to the normal claims, rebuilt from the employee record
  } else {
    if (company.status !== 'ACTIVE') return fail(400, `${company.name} is not active.`);
    const existing = await adminAuth().getUser(ctx.uid);
    const keepPa = (existing.customClaims as TenantClaims | undefined)?.pa === true;
    const claims: TenantClaims = { cid: company.id, cs: 'ACTIVE', perms: [], adm: true, aid: account.id, ga: true, hid: home };
    await adminAuth().setCustomUserClaims(ctx.uid, keepPa ? { ...claims, pa: true } : claims);
  }
  await audit(account.id, 'SWITCH_ORG', ctx.uid, { from: ctx.companyId, to: companyId });
  return ok({ companyId, name: company.name, home: companyId === home });
}

/** Platform admin (any account) or a group admin (own account): add or remove a group administrator. */
async function setGroupAdmin(headers: Record<string, any>, body: any, deps: OrgDeps): Promise<OrgResult> {
  let accountId: string;
  let actorUid: string;
  let byPlatform = false;
  const ctx = await authenticate(headers);
  if (ctx.isPlatformAdmin) {
    await requirePlatformAdmin(headers);
    accountId = str(body.accountId, 128);
    actorUid = ctx.uid;
    byPlatform = true;
  } else {
    const g = await requireGroupAdmin(headers);
    accountId = g.account.id;
    actorUid = g.ctx.uid;
  }
  const account = await loadAccount(accountId);
  if (!account) return fail(404, 'Account not found.');

  const email = str(body.email, 200).toLowerCase();
  const enabled = body.enabled !== false;
  if (!email) return fail(400, 'Enter the email of the person.');
  const found = await db().collection('employees').where('email', '==', email).get();
  let uid = '';
  for (const d of found.docs) {
    const e = d.data() as any;
    const c = await db().collection('companies').doc(String(e.companyId)).get();
    if (c.exists && (c.data() as any).accountId === account.id) { uid = String(e.authUid || e.id); break; }
  }
  if (!uid) return fail(404, 'No employee with this email in this account.');

  const list = new Set(account.groupAdminUids || []);
  if (enabled) list.add(uid);
  else {
    list.delete(uid);
    if (!byPlatform && list.size === 0) return fail(400, 'An account needs at least one group administrator.');
  }
  await db().collection('accounts').doc(account.id).update({ groupAdminUids: [...list], updatedAt: nowIso() });
  await deps.syncUser(uid); // rebuilds claims from the employee record, which also puts them back in their home organisation
  if (!enabled) await adminAuth().revokeRefreshTokens(uid).catch(() => {});
  await audit(account.id, enabled ? 'GROUP_ADMIN_ADDED' : 'GROUP_ADMIN_REMOVED', actorUid, { uid, email });
  return ok({ accountId: account.id, uid, enabled, groupAdmins: [...list] });
}

/** Returns null when the action is not an organisation action. */
export async function routeOrgAction(method: string, action: string, headers: Record<string, any>, body: any, deps: OrgDeps): Promise<OrgResult | null> {
  if (method === 'GET' && action === 'my-organisations') return myOrganisations(headers);
  if (method === 'POST' && action === 'switch-organisation') return switchOrganisation(headers, body, deps);
  if (method === 'POST' && action === 'set-group-admin') return setGroupAdmin(headers, body, deps);
  return null;
}
