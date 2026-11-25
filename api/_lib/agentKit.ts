/**
 * Shared kit for the Ask HR agent: what every tool pack (Leave, People, ...) uses.
 *
 *  - Run: one question's state (who is asking, a cache, the facts the model was given, the proposals made)
 *  - route(): calls an existing module route as the signed-in person, so that route does every permission check
 *  - give(): returns a tool result to the model and records it as a fact (numbers in answers must come from facts)
 *  - makeProposal() / proposed(): save a confirm card; nothing runs until the person confirms (see assistantApi.confirm)
 */
import { adminDb } from './firebaseAdmin.js';
import { type AuthContext } from './authContext.js';
import { routeLeave } from './leaveApi.js';
import { routeLifecycle } from './lifecycleApi.js';
import { routePayroll } from './payrollApi.js';
import { routeHome } from './homeApi.js';
import { PROPOSAL_TTL_MS, type ProposalAction, type ProposalCard } from '../../shared/leaveAgentTools.js';

export type Result = { status: number; json: any };
export const db = () => adminDb();
export const str = (v: unknown, max = 500) => (v === undefined || v === null ? '' : String(v)).trim().slice(0, max);
/** The Ask HR panel shows plain text, so markdown the model slips in (bold, headings, code ticks, "* " bullets) is removed. */
export const plainText = (s: string) => s
  .replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1').replace(/`([^`\n]+)`/g, '$1')
  .replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^(\s*)[*•]\s+/gm, '$1- ').replace(/\*\*/g, '');
export const istDay = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export interface Source { kind: 'data' | 'policy'; label: string }

export interface Run {
  headers: Record<string, any>;
  ctx: AuthContext;
  cid: string;
  cache: Map<string, any>;
  sources: Map<string, Source>;
  facts: string[];
  tools: string[];
  proposals: ProposalCard[];
}

export async function route(r: Run, router: 'leave' | 'lifecycle' | 'payroll' | 'home', method: 'GET' | 'POST', action: string, body?: any, query: Record<string, any> = {}): Promise<any> {
  const key = `${router}:${method}:${action}:${JSON.stringify(body || '')}:${JSON.stringify(query)}`;
  if (r.cache.has(key)) return r.cache.get(key);
  const req = { method, action, query, body: body ?? {}, headers: r.headers };
  let res: { status: number; json: any };
  try {
    res = router === 'leave' ? await routeLeave(req) : router === 'lifecycle' ? await routeLifecycle(req) : router === 'payroll' ? await routePayroll(req) : await routeHome(req);
  } catch (e: any) {
    res = { status: 500, json: { success: false, error: String(e?.message || 'failed') } };
  }
  const out = res.status === 200 && res.json?.success !== false ? res.json : { error: str(res.json?.error, 200) || 'Not available.' };
  r.cache.set(key, out);
  return out;
}

export const give = (r: Run, tool: string, source: Source | null, data: any) => {
  r.tools.push(tool);
  if (source) r.sources.set(`${source.kind}:${source.label}`, source);
  const text = JSON.stringify(data);
  r.facts.push(text);
  return text.length > 7000 ? text.slice(0, 7000) : text;
};

export const PROPOSALS = 'agentProposals';

/** Saves a proposal and returns the card. The same proposal asked for twice in one question is saved once. */
export async function makeProposal(r: Run, action: ProposalAction, params: Record<string, any>, card: Omit<ProposalCard, 'id' | 'action'>): Promise<ProposalCard> {
  const key = `proposal:${action}:${JSON.stringify(params)}`;
  const seen = r.cache.get(key) as ProposalCard | undefined;
  if (seen) return seen;
  const ref = db().collection(PROPOSALS).doc();
  const now = Date.now();
  await ref.set({
    id: ref.id, companyId: r.cid, uid: r.ctx.uid, action, params, title: card.title, lines: card.lines, status: 'PENDING',
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + PROPOSAL_TTL_MS).toISOString(),
  });
  const full: ProposalCard = { id: ref.id, action, ...card };
  r.cache.set(key, full);
  r.proposals.push(full);
  return full;
}

export const proposed = (r: Run, name: string, card: ProposalCard) => give(r, name, null, {
  proposed: true, title: card.title, details: card.lines,
  instruction: 'A confirm card is now on the person\'s screen. Tell them in one or two sentences what you prepared and ask them to press Confirm. Never say it is done; nothing happens until they confirm.',
});
