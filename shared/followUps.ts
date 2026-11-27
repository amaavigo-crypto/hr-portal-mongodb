/**
 * Automatic follow-ups: the rules, working hours, and which reminders are due. Pure TypeScript, so the server, the screen
 * and the tests share one definition. Sending, storage and the "once a day" guarantee are in api/_lib/followUpApi.ts.
 */
export type FollowUpRuleId = 'feedback' | 'waiting' | 'offer' | 'test' | 'escalate';

export interface FollowUpRuleDef {
  id: FollowUpRuleId; title: string; unit: 'hours' | 'days' | 'reminders'; defaultAfter: number; min: number; max: number; defaultOn: boolean; to: string;
  /** Sentence shown on the screen, with the chosen number put in. */
  when: (n: number) => string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const FOLLOW_UP_RULES: FollowUpRuleDef[] = [
  { id: 'feedback', title: 'Interview feedback missing', unit: 'hours', defaultAfter: 4, min: 1, max: 72, defaultOn: true, to: 'the interviewer', when: (n) => `${plural(n, 'hour')} after the interview, then daily` },
  { id: 'waiting', title: 'Candidate waiting too long', unit: 'days', defaultAfter: 3, min: 1, max: 30, defaultOn: true, to: 'the recruiter', when: (n) => `After ${plural(n, 'day')} in the same step` },
  { id: 'offer', title: 'Offer approval pending', unit: 'days', defaultAfter: 1, min: 1, max: 14, defaultOn: true, to: 'the approver', when: (n) => `After ${plural(n, 'day')} without a decision` },
  { id: 'test', title: 'Test not started', unit: 'days', defaultAfter: 1, min: 1, max: 5, defaultOn: false, to: 'the candidate', when: (n) => `${plural(n, 'day')} before the test link runs out` },
  { id: 'escalate', title: 'Still stuck after reminders', unit: 'reminders', defaultAfter: 2, min: 1, max: 10, defaultOn: false, to: 'the Head of HR', when: (n) => `After ${plural(n, 'reminder')} with no action` },
];

export interface FollowUpSettings { enabled: boolean; rules: Record<FollowUpRuleId, { on: boolean; after: number }> }

/** Always off until a person turns it on. */
export function defaultFollowUpSettings(): FollowUpSettings {
  return { enabled: false, rules: Object.fromEntries(FOLLOW_UP_RULES.map((r) => [r.id, { on: r.defaultOn, after: r.defaultAfter }])) as FollowUpSettings['rules'] };
}

export function cleanFollowUpSettings(input: any, base: FollowUpSettings = defaultFollowUpSettings()): FollowUpSettings {
  const out: FollowUpSettings = { enabled: typeof input?.enabled === 'boolean' ? input.enabled : base.enabled, rules: { ...base.rules } };
  for (const def of FOLLOW_UP_RULES) {
    const r = input?.rules?.[def.id];
    if (!r) continue;
    const n = Math.round(Number(r.after));
    out.rules[def.id] = {
      on: typeof r.on === 'boolean' ? r.on : base.rules[def.id].on,
      after: Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, n)) : base.rules[def.id].after,
    };
  }
  return out;
}

export const WORKING_HOURS_TEXT = 'Monday to Friday, 9 am to 6 pm India time';
const IST = 5.5 * 3600_000;
export const istDayOf = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
export function isWorkingTime(now: Date): boolean {
  const t = new Date(now.getTime() + IST);
  const day = t.getUTCDay();
  return day >= 1 && day <= 5 && t.getUTCHours() >= 9 && t.getUTCHours() < 18;
}

export interface Contact { email: string; name: string }
export interface FollowUpFacts {
  interviews: { id: string; applicationId: string; candidateName: string; round: string; position: string; status: string; startIso: string; durationMinutes: number; pending: Contact[] }[];
  waiting: { id: string; applicationId: string; candidateName: string; position: string; stepTitle: string; since: string; to: Contact[] }[];
  offers: { id: string; applicationId: string; candidateName: string; position: string; waitingSince: string; to: Contact[] }[];
  tests: { id: string; applicationId: string; candidate: Contact; position: string; expiresAt: string; link: string }[];
}

export interface DueReminder {
  ruleId: FollowUpRuleId;
  /** Stays the same for one piece of waiting work, so it is reminded at most once a day. */
  targetKey: string;
  applicationId: string;
  candidateName: string;
  position: string;
  to: Contact;
  why: string;
  subject: string;
  body: string;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Work older than this is not chased: switching follow-ups on must not email people about long-forgotten records. */
export const LOOKBACK_DAYS = 30;

const hello = (c: Contact, lines: string[], company: string) => [`Hi ${c.name || 'there'},`, '', ...lines, '', company].join('\n');

/** Every reminder that is due right now (before the once-a-day and working-hours checks). Escalation is added by dueEscalations. */
export function dueReminders(f: FollowUpFacts, s: FollowUpSettings, now: Date, company: string, appUrl = ''): DueReminder[] {
  const out: DueReminder[] = [];
  const t = now.getTime();
  const recent = (iso: string) => t - Date.parse(iso) <= LOOKBACK_DAYS * DAY;
  const open = appUrl ? `Open it here: ${appUrl}` : 'Open Hiring in the HR portal to do it.';
  const add = (r: Omit<DueReminder, 'body'>, lines: string[]) => { if (r.to.email) out.push({ ...r, body: hello(r.to, lines, company) }); };

  if (s.rules.feedback.on) for (const i of f.interviews) {
    const ended = Date.parse(i.startIso) + (i.durationMinutes || 45) * 60_000;
    if (i.status !== 'SCHEDULED' || !(t - ended >= s.rules.feedback.after * HOUR) || !recent(i.startIso)) continue;
    for (const p of i.pending) add({ ruleId: 'feedback', targetKey: `interview:${i.id}`, applicationId: i.applicationId, candidateName: i.candidateName, position: i.position, to: p,
      why: `Feedback for ${i.round} with ${i.candidateName} has not been submitted.`, subject: `Feedback needed: ${i.candidateName} (${i.round})` },
      [`Your feedback for the ${i.round} with ${i.candidateName} (${i.position}) is still missing.`, open]);
  }
  if (s.rules.waiting.on) for (const w of f.waiting) {
    const days = Math.floor((t - Date.parse(w.since)) / DAY);
    if (!(days >= s.rules.waiting.after) || !recent(w.since)) continue;
    for (const p of w.to) add({ ruleId: 'waiting', targetKey: `step:${w.id}`, applicationId: w.applicationId, candidateName: w.candidateName, position: w.position, to: p,
      why: `${w.candidateName} has been in "${w.stepTitle}" for ${plural(days, 'day')}.`, subject: `${w.candidateName} is waiting at "${w.stepTitle}"` },
      [`${w.candidateName} (${w.position}) has been in the step "${w.stepTitle}" for ${plural(days, 'day')}.`, open]);
  }
  if (s.rules.offer.on) for (const o of f.offers) {
    if (!(t - Date.parse(o.waitingSince) >= s.rules.offer.after * DAY) || !recent(o.waitingSince)) continue;
    for (const p of o.to) add({ ruleId: 'offer', targetKey: `offer:${o.id}`, applicationId: o.applicationId, candidateName: o.candidateName, position: o.position, to: p,
      why: `The offer for ${o.candidateName} is waiting for approval.`, subject: `Offer approval waiting: ${o.candidateName}` },
      [`The offer for ${o.candidateName} (${o.position}) is waiting for your decision.`, open]);
  }
  if (s.rules.test.on) for (const x of f.tests) {
    const left = Date.parse(x.expiresAt) - t;
    if (!(left > 0 && left <= s.rules.test.after * DAY)) continue;
    add({ ruleId: 'test', targetKey: `test:${x.id}`, applicationId: x.applicationId, candidateName: x.candidate.name, position: x.position, to: x.candidate,
      why: `The test link runs out on ${x.expiresAt.slice(0, 10)} and the test has not been started.`, subject: `Reminder: your ${x.position} test` },
      [`This is a reminder that your test for the ${x.position} role has not been started.`, `Please start it by ${x.expiresAt.slice(0, 10)}.`, ...(x.link ? [`Open your test: ${x.link}`] : ['Use the link in the earlier email.'])]);
  }
  return out;
}

/** Work that is still due after enough earlier reminders goes to the Head of HR as well. `earlierDays` = distinct days already reminded. */
export function dueEscalations(due: DueReminder[], s: FollowUpSettings, earlierDays: Map<string, number>, heads: Contact[], company: string): DueReminder[] {
  if (!s.rules.escalate.on) return [];
  const seen = new Set<string>();
  const out: DueReminder[] = [];
  for (const d of due) {
    if (d.ruleId === 'test' || seen.has(d.targetKey) || (earlierDays.get(d.targetKey) || 0) < s.rules.escalate.after) continue;
    seen.add(d.targetKey);
    for (const h of heads) if (h.email && h.email !== d.to.email) out.push({
      ...d, ruleId: 'escalate', targetKey: `escalate:${d.targetKey}`, to: h, why: `Still not done after reminders: ${d.why}`,
      subject: `Still stuck: ${d.candidateName}`, body: hello(h, [`This has not moved after ${plural(earlierDays.get(d.targetKey)!, 'reminder')}:`, d.why], company),
    });
  }
  return out;
}
