/**
 * Quick rules: WHEN a new application arrives, IF it matches, THEN do simple things. Pure TypeScript shared by server,
 * screen and tests. By design there is no action that rejects a candidate or changes their stage.
 */
export type RuleField = 'experience' | 'job' | 'source' | 'city' | 'score';
export type RuleOp = 'atLeast' | 'is' | 'contains';
export interface RuleCondition { field: RuleField; op: RuleOp; value: string }
export type RuleAction =
  | { type: 'tag'; tag: string }
  | { type: 'notify'; uid: string }
  | { type: 'ack'; subject: string; message: string };
export interface QuickRuleInput { name: string; conditions: RuleCondition[]; actions: RuleAction[] }

export const FIELD_LABEL: Record<RuleField, string> = { experience: 'Experience (years)', job: 'Job', source: 'Came from', city: 'City', score: 'Skills found in resume (%)' };
export const FIELD_OPS: Record<RuleField, RuleOp[]> = { experience: ['atLeast'], job: ['is', 'contains'], source: ['is', 'contains'], city: ['is', 'contains'], score: ['atLeast'] };
export const OP_LABEL: Record<RuleOp, string> = { atLeast: 'is at least', is: 'is', contains: 'contains' };
export const MAX_CONDITIONS = 5;
export const MAX_ACTIONS = 3;
export const MAX_RULES = 20;

export const RULE_TEMPLATES: { id: string; title: string; blurb: string; rule: QuickRuleInput }[] = [
  { id: 'experienced', title: 'Tag experienced applicants', blurb: 'Add a tag when someone has 5 or more years.', rule: { name: 'Tag experienced applicants', conditions: [{ field: 'experience', op: 'atLeast', value: '5' }], actions: [{ type: 'tag', tag: 'Experienced' }] } },
  { id: 'ack', title: 'Acknowledge every application', blurb: 'Email each applicant to say you received it.', rule: { name: 'Acknowledge every application', conditions: [], actions: [{ type: 'ack', subject: 'We received your application for {job}', message: 'Hi {name},\n\nThank you for applying for the {job} role at {company}. We have received your application and will be in touch if there is a next step.\n\n{company}' }] } },
  { id: 'strong', title: 'Alert on strong resumes', blurb: 'Tell the recruiter when a resume shows most of the job\'s skills.', rule: { name: 'Alert on strong resumes', conditions: [{ field: 'score', op: 'atLeast', value: '75' }], actions: [{ type: 'notify', uid: '' }, { type: 'tag', tag: 'Strong resume' }] } },
  { id: 'blank', title: 'Blank rule', blurb: 'Choose everything yourself.', rule: { name: '', conditions: [], actions: [{ type: 'tag', tag: '' }] } },
];

const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

export function cleanRule(input: any): { value?: QuickRuleInput; error?: string } {
  const name = text(input?.name, 80);
  if (!name) return { error: 'Give the rule a name.' };
  const conditions: RuleCondition[] = [];
  const rawC = Array.isArray(input?.conditions) ? input.conditions : [];
  if (rawC.length > MAX_CONDITIONS) return { error: `A rule can have up to ${MAX_CONDITIONS} conditions.` };
  for (const c of rawC) {
    const field = String(c?.field) as RuleField;
    if (!(field in FIELD_OPS)) return { error: 'A condition has an unknown field.' };
    const op = String(c?.op) as RuleOp;
    if (!FIELD_OPS[field].includes(op)) return { error: `"${FIELD_LABEL[field]}" cannot be compared that way.` };
    const value = text(c?.value, 120);
    if (!value) return { error: `Fill in a value for "${FIELD_LABEL[field]}".` };
    if (op === 'atLeast' && !(Number(value) >= 0 && Number(value) <= (field === 'score' ? 100 : 60))) return { error: `Enter a sensible number for "${FIELD_LABEL[field]}".` };
    conditions.push({ field, op, value });
  }
  const actions: RuleAction[] = [];
  const rawA = Array.isArray(input?.actions) ? input.actions : [];
  if (!rawA.length) return { error: 'Choose at least one thing for the rule to do.' };
  if (rawA.length > MAX_ACTIONS) return { error: `A rule can do up to ${MAX_ACTIONS} things.` };
  for (const a of rawA) {
    if (a?.type === 'tag') {
      const tag = text(a.tag, 30);
      if (!tag) return { error: 'Type the tag to add.' };
      actions.push({ type: 'tag', tag });
    } else if (a?.type === 'notify') actions.push({ type: 'notify', uid: text(a.uid, 128) });
    else if (a?.type === 'ack') {
      const subject = text(a.subject, 200).replace(/[\r\n]+/g, ' ');
      const message = text(a.message, 3000);
      if (!subject || !message) return { error: 'Write the subject and message of the email to the applicant.' };
      actions.push({ type: 'ack', subject, message });
    } else return { error: 'That action is not available. Quick rules cannot reject candidates or move them to another stage.' };
  }
  return { value: { name, conditions, actions } };
}

export interface RuleFacts { job: string; experience: number | null; source: string; city: string; score: number | null }

/** true / false, or null when it cannot be told yet (the resume has not been read, so there is no score). */
export function matches(conditions: RuleCondition[], f: RuleFacts): boolean | null {
  let unknown = false;
  for (const c of conditions) {
    if (c.op === 'atLeast') {
      const have = c.field === 'score' ? f.score : f.experience;
      if (have === null) { if (c.field === 'score') { unknown = true; continue; } return false; }
      if (!(have >= Number(c.value))) return false;
      continue;
    }
    const have = String(f[c.field] ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const want = c.value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (c.op === 'is' ? have !== want : !have.includes(want)) return false;
  }
  return unknown ? null : true;
}

export const fill = (s: string, v: { name: string; job: string; company: string }) => s.replace(/\{(name|job|company)\}/g, (_m, k: 'name' | 'job' | 'company') => v[k]);

export function describeAction(a: RuleAction, personName?: string): string {
  if (a.type === 'tag') return `Add the tag "${a.tag}"`;
  if (a.type === 'notify') return `Email ${personName || 'the recruiter'}`;
  return 'Email the applicant an acknowledgement';
}
