/**
 * "Needs attention" for the bell: everything waiting for the signed-in person, from every module.
 *
 *   GET /api/leave/home-attention   -> { total, groups: [{ module, label, count, items, more }], partial }
 *
 * Each source is the module's OWN route, called with the person's own login, so company, role and permission checks are the ones
 * that already apply (an employee gets only their own items, a manager their team's, HR the company's). A source that fails is
 * skipped and the answer is marked `partial`; one slow or broken module never blanks the bell. The list is live: nothing is
 * stored, and an item disappears when its work is done. The same answer feeds the Ask HR agent (get_my_attention).
 */
import { requireActiveTenant, type AuthContext } from './authContext.js';
import { routeLeave } from './leaveApi.js';
import { routeLifecycle } from './lifecycleApi.js';
import { routePayroll } from './payrollApi.js';
import { routePm } from './pmApi.js';
import { routeHome } from './homeApi.js';
import { loadDocumentData } from './documentAgent.js';
import {
  ackItems, assemble, leaveItems, payrollItems, peopleItems, performanceItems, reviewItems, taskItems, type AttentionItem, type AttentionResult,
} from '../../shared/attention.js';
import { canReviewDocuments, summarizeReviewQueue } from '../../shared/documentAgentTools.js';
import { addDays } from '../../shared/leaveAgentTools.js';
import { istToday } from '../../shared/leaveEngine.js';

type Headers = Record<string, any>;
const ok = (j: any) => !!j && j.success !== false && !j.error;

async function call(fn: (r: any) => Promise<{ status: number; json: any }>, headers: Headers, action: string, query: Record<string, any> = {}) {
  const res = await fn({ method: 'GET', action, query, body: {}, headers });
  if (res.status >= 400 || !ok(res.json)) throw new Error(`${action}: ${res.status}`);
  return res.json;
}

const previousMonth = (today: string) => { const m = addDays(`${today.slice(0, 7)}-01`, -1); return m.slice(0, 7); };

/** The person's list. `headers` carries their login. */
export async function attentionFor(headers: Headers): Promise<AttentionResult> {
  const ctx: AuthContext = await requireActiveTenant(headers);
  const today = istToday();
  const cid = ctx.companyId as string;
  let failed = false;

  // Each source returns items, or [] when the module says there is nothing (or the person has no access to it).
  const source = async (fn: () => Promise<AttentionItem[]>): Promise<AttentionItem[]> => {
    try { return await fn(); } catch (e: any) {
      // A 403 means "not for this person", which is normal. Anything else means the source is down.
      if (!/: (401|403|404)$/.test(String(e?.message))) failed = true;
      return [];
    }
  };

  const results = await Promise.all([
    source(async () => leaveItems(await call(routeLeave, headers, 'inbox'))),
    source(async () => ackItems(await call(routeHome, headers, 'acks'))),
    source(async () => {
      if (!canReviewDocuments(ctx)) return [];
      const { versions } = await loadDocumentData(cid);
      return reviewItems(summarizeReviewQueue(versions, today, { perms: ctx.perms, isCompanyAdmin: ctx.isCompanyAdmin, uid: ctx.uid }, 50));
    }),
    source(async () => taskItems(await call(routeLifecycle, headers, 'onboarding-my'), today)),
    source(async () => { const j = await call(routeLifecycle, headers, 'people-review'); return peopleItems(Array.isArray(j.rows) ? j.rows : [], ctx.uid, today); }),
    source(async () => performanceItems(await call(routePm, headers, 'home'))),
    source(async () => {
      const months = [today.slice(0, 7), previousMonth(today)];
      const states = await Promise.all(months.map(async (month) => ({ month, state: await call(routePayroll, headers, 'approval-state', { month }) })));
      return payrollItems(states);
    }),
  ]);
  return assemble(results.flat(), failed);
}
