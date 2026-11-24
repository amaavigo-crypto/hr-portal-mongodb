/**
 * Accounts: the customer that buys a plan. An account owns one or more organisations (the `companies` records).
 * Every organisation belongs to exactly one account. Stage 1 only creates and links accounts; plan, modules and
 * limits still live on the company until they are moved here later.
 *
 * The account id is derived from the company it was created for (`acc_<companyId>`), so creating it twice is harmless.
 */
import type { Firestore } from 'firebase-admin/firestore';

export interface AccountDoc {
  id: string;
  name: string;
  ownerEmail: string;
  /** How many organisations this account may hold. */
  orgLimit: number;
  /** Plan and modules for every organisation of the account (changing them updates each organisation). */
  plan?: string;
  modules?: string[];
  /** Users who may switch between this account's organisations and act as administrator in each. */
  groupAdminUids?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AccountSource { id: string; name: string; adminEmail?: string; accountId?: string }

export const DEFAULT_ORG_LIMIT = 1;
export const accountIdFor = (companyId: string): string => `acc_${companyId}`;

export function newAccountDoc(company: AccountSource, ts: string): AccountDoc {
  return {
    id: company.accountId || accountIdFor(company.id),
    name: company.name,
    ownerEmail: String(company.adminEmail || '').toLowerCase(),
    orgLimit: DEFAULT_ORG_LIMIT,
    groupAdminUids: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Makes sure the company has an account and is linked to it. Safe to run any number of times. */
export async function ensureAccount(db: Firestore, company: AccountSource): Promise<{ accountId: string; created: boolean; linked: boolean }> {
  const accountId = company.accountId || accountIdFor(company.id);
  const ref = db.collection('accounts').doc(accountId);
  const existing = await ref.get();
  let created = false;
  if (!existing.exists) {
    await ref.set(newAccountDoc({ ...company, accountId }, new Date().toISOString()));
    created = true;
  }
  let linked = false;
  if (company.accountId !== accountId) {
    await db.collection('companies').doc(company.id).update({ accountId, updatedAt: new Date().toISOString() });
    linked = true;
  }
  return { accountId, created, linked };
}

/** Gives every existing company an account. Run by a platform admin; running it again changes nothing. */
export async function backfillAccounts(db: Firestore): Promise<{ checked: number; created: number; linked: number }> {
  const snap = await db.collection('companies').get();
  let created = 0, linked = 0;
  for (const d of snap.docs) {
    const c = d.data() as any;
    const r = await ensureAccount(db, { id: d.id, name: String(c.name || d.id), adminEmail: c.adminEmail, accountId: c.accountId });
    if (r.created) created++;
    if (r.linked) linked++;
  }
  return { checked: snap.docs.length, created, linked };
}

/** After a company is deleted: remove its account too, unless other organisations still belong to it. */
export async function releaseAccountIfEmpty(db: Firestore, accountId: string | undefined): Promise<boolean> {
  if (!accountId) return false;
  const left = await db.collection('companies').where('accountId', '==', accountId).limit(1).get();
  if (!left.empty) return false;
  await db.collection('accounts').doc(accountId).delete().catch(() => {});
  return true;
}
