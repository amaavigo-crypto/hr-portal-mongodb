/**
 * Approval chains for any kind of request (purchase, expense, travel, a custom form ...). Pure functions, no database.
 *
 * A chain is an ordered list of steps. Each step names who approves: the requester's manager, the manager's manager, or
 * specific people (any one of them, or all of them). Which chain applies depends on the request kind and, optionally, an
 * amount: of the active chains for that kind, the one with the highest `minAmount` the request reaches is used.
 */
export type ApproverKind = 'MANAGER' | 'SKIP_LEVEL' | 'PEOPLE';
export interface StepDef { name: string; approver: ApproverKind; uids?: string[]; mode: 'ANY' | 'ALL' }
export interface ChainDef { id: string; name: string; kind: string; minAmount: number; active: boolean; steps: StepDef[]; fallbackUids: string[] }

export interface StepState { name: string; approverUids: string[]; mode: 'ANY' | 'ALL'; approvedBy: string[]; status: 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' }
export type ReqStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export interface RequestLike { status: ReqStatus; steps: StepState[]; current: number; requesterUid: string }

export const MAX_STEPS = 8;

export function cleanChain(input: any): { chain?: Omit<ChainDef, 'id'>; error?: string } {
  const name = String(input?.name ?? '').trim().slice(0, 80);
  const kind = String(input?.kind ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40);
  if (!name) return { error: 'Give the chain a name.' };
  if (!kind) return { error: 'Say what kind of request this chain is for (for example: purchase).' };
  const raw = Array.isArray(input?.steps) ? input.steps : [];
  if (!raw.length) return { error: 'Add at least one step.' };
  if (raw.length > MAX_STEPS) return { error: `At most ${MAX_STEPS} steps.` };
  const steps: StepDef[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    const approver: ApproverKind | null = ['MANAGER', 'SKIP_LEVEL', 'PEOPLE'].includes(s?.approver) ? s.approver : null;
    if (!approver) return { error: `Step ${i + 1}: choose who approves.` };
    const uids = Array.from(new Set((Array.isArray(s?.uids) ? s.uids : []).map((u: any) => String(u).trim()).filter(Boolean))) as string[];
    if (approver === 'PEOPLE' && !uids.length) return { error: `Step ${i + 1}: choose at least one person.` };
    steps.push({ name: String(s?.name ?? '').trim().slice(0, 60) || `Step ${i + 1}`, approver, ...(approver === 'PEOPLE' ? { uids: uids.slice(0, 20) } : {}), mode: s?.mode === 'ALL' ? 'ALL' : 'ANY' });
  }
  const min = Number(input?.minAmount ?? 0);
  if (!Number.isFinite(min) || min < 0 || min > 1e12) return { error: 'The minimum amount must be a number, 0 or more.' };
  const fallbackUids = Array.from(new Set((Array.isArray(input?.fallbackUids) ? input.fallbackUids : []).map((u: any) => String(u).trim()).filter(Boolean))).slice(0, 10) as string[];
  return { chain: { name, kind, minAmount: min, active: input?.active !== false, steps, fallbackUids } };
}

/** The chain that applies to a request, or undefined when none is set up for its kind. */
export function matchChain(chains: ChainDef[], kind: string, amount: number): ChainDef | undefined {
  return chains.filter((c) => c.active && c.kind === kind && amount >= c.minAmount).sort((a, b) => b.minAmount - a.minAmount)[0];
}

export interface Resolver { managerOf(uid: string): string; isActive(uid: string): boolean }

/**
 * Works out who approves each step. A step with nobody to approve (no manager, an inactive person) falls back to the chain's
 * fallback people; with none, the request cannot be sent. The requester never approves their own request: they are removed
 * from each step, and a step left empty falls back the same way.
 */
export function resolveSteps(chain: ChainDef, requesterUid: string, r: Resolver): { steps?: StepState[]; error?: string } {
  const out: StepState[] = [];
  for (const [i, s] of chain.steps.entries()) {
    let uids: string[] = [];
    if (s.approver === 'MANAGER') uids = [r.managerOf(requesterUid)];
    else if (s.approver === 'SKIP_LEVEL') uids = [r.managerOf(r.managerOf(requesterUid))];
    else uids = s.uids || [];
    uids = Array.from(new Set(uids.filter((u) => u && u !== requesterUid && r.isActive(u))));
    if (!uids.length) uids = chain.fallbackUids.filter((u) => u !== requesterUid && r.isActive(u));
    if (!uids.length) return { error: `No one could be found to approve "${s.name}" (step ${i + 1}). Ask an administrator to set a manager or a fallback approver.` };
    out.push({ name: s.name, approverUids: uids, mode: uids.length > 1 ? s.mode : 'ANY', approvedBy: [], status: i === 0 ? 'PENDING' : 'WAITING' });
  }
  return { steps: out };
}

export function canDecide(req: RequestLike, uid: string): { ok: boolean; reason?: string } {
  if (req.status !== 'PENDING') return { ok: false, reason: `This request is already ${req.status.toLowerCase()}.` };
  const step = req.steps[req.current];
  if (!step || !step.approverUids.includes(uid)) return { ok: false, reason: 'It is not waiting for you.' };
  if (step.approvedBy.includes(uid)) return { ok: false, reason: 'You have already approved this step.' };
  return { ok: true };
}

/** Applies one decision. Returns the updated request (a copy) and what happened. */
export function decide<T extends RequestLike>(req: T, uid: string, approve: boolean): { req: T; event: 'STEP_APPROVED' | 'APPROVED' | 'REJECTED' | 'WAITING_FOR_OTHERS' } {
  const next: T = JSON.parse(JSON.stringify(req));
  const step = next.steps[next.current];
  if (!approve) { step.status = 'REJECTED'; next.status = 'REJECTED'; return { req: next, event: 'REJECTED' }; }
  step.approvedBy.push(uid);
  const done = step.mode === 'ALL' ? step.approverUids.every((u) => step.approvedBy.includes(u)) : true;
  if (!done) return { req: next, event: 'WAITING_FOR_OTHERS' };
  step.status = 'APPROVED';
  if (next.current + 1 >= next.steps.length) { next.status = 'APPROVED'; return { req: next, event: 'APPROVED' }; }
  next.current += 1;
  next.steps[next.current].status = 'PENDING';
  return { req: next, event: 'STEP_APPROVED' };
}
