/**
 * HRBP AI Project Planner: everything that must NOT be left to the AI. Pure code (no database, no network), tested on its
 * own in tests/projectPlanner.test.ts.
 *
 *  - cleaning what the AI read from a brief, and refusing money figures that do not appear in the source text
 *  - skills: normalising, suggestions from job title and certificates, fit of a person to a role
 *  - availability (leave, notice period, other approved projects) and the team match
 *  - checking the AI's plan (phases, tasks, risks) and turning it into dates and owners
 *  - every rupee: people cost from CTC, phase split, budget headroom, profit and margin, and the health checks
 *
 * The AI never sees a salary and never produces a number that is shown as money.
 */

// ------------------------------------------------------------------ small helpers

export const clip = (v: unknown, max = 200): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const list = (v: unknown, max: number, len = 160): string[] => (Array.isArray(v) ? v : []).map((x) => clip(x, len)).filter(Boolean).slice(0, max);
const money = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) && n > 0 && n < 1e11 ? Math.round(n) : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monday to Friday between two dates, both included. */
export function workingDays(from: string, to: string): number {
  if (!isDate(from) || !isDate(to) || to < from) return 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { const w = weekday(d); if (w !== 0 && w !== 6) n++; }
  return n;
}
export const weeksOf = (from: string, to: string) => Math.max(1, Math.min(104, Math.ceil(workingDays(from, to) / 5)));

/** Indian grouping for display: 1462400 -> ₹14,62,400. */
export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const neg = n < 0;
  const s = String(Math.round(Math.abs(n)));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}₹${rest ? `${rest},${last3}` : last3}`;
}
/** Short form for headlines: ₹14.62L, ₹1.2Cr, ₹48,000. */
export function inrShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`;
  return inr(n);
}

// ------------------------------------------------------------------ the brief

export interface BriefRole { title: string; skills: string[]; count: number; allocation: number }
export interface OtherCost { label: string; amount: number }
export interface Brief {
  name: string;
  summary: string;
  goals: string[];
  deliverables: string[];
  startDate: string;
  endDate: string;
  budget: number | null;
  clientPrice: number | null;
  otherCosts: OtherCost[];
  roles: BriefRole[];
  constraints: string[];
  /** What the reader could not find or did not trust; shown above the brief editor. */
  warnings: string[];
}

/**
 * Is this amount really written in the source? Accepts 1800000, 18,00,000, 1,800,000, "18 lakh", "18L", "1.8 crore", "18 lacs",
 * "1800k". Used so a money figure the AI "read" from a document is only kept when the document actually says it.
 */
export function amountInText(n: number, text: string): boolean {
  if (!Number.isFinite(n) || n <= 0) return false;
  const t = text.toLowerCase().replace(/(\d),(?=\d)/g, '$1').replace(/(\d)\s+(?=\d{3}\b)/g, '$1');
  const has = (num: string) => new RegExp(`(^|[^\\d.])${num.replace('.', '\\.')}(?![\\d])`).test(t);
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(round2(x)).replace(/0+$/, '').replace(/\.$/, ''));
  if (has(String(Math.round(n)))) return true;
  const unit = (div: number, words: string) => {
    const x = n / div;
    if (x < 0.01) return false;
    const forms = new Set([fmt(x), x.toFixed(1), x.toFixed(2)].map((f) => f.replace(/\.0+$/, '')));
    return [...forms].some((f) => new RegExp(`(^|[^\\d.])${f.replace('.', '\\.')}\\s*(${words})\\b`).test(t));
  };
  return unit(1e5, 'lakhs?|lacs?|lakh|l') || unit(1e7, 'crores?|cr') || unit(1e3, 'k|thousand') || unit(1e6, 'million|mn|m');
}

/**
 * Turns what the AI read into a brief we can trust. `typed` (what the person typed in the form) always wins over the AI.
 * Money read from a document is dropped unless the document says it (`source` is that text; empty for a typed brief).
 */
export function cleanBrief(ai: any, typed: Partial<Record<keyof Brief, any>>, source: string, today: string): Brief {
  const warnings: string[] = [];
  const pickMoney = (field: 'budget' | 'clientPrice', label: string): number | null => {
    const t = money(typed[field]);
    if (t !== null) return t;
    const a = money(ai?.[field]);
    if (a === null) return null;
    if (source && !amountInText(a, source)) { warnings.push(`The ${label} could not be found written in the document, so it was left empty. Enter it if you know it.`); return null; }
    return a;
  };
  const roles: BriefRole[] = (Array.isArray(ai?.roles) ? ai.roles : []).slice(0, 15).map((r: any) => ({
    title: clip(r?.title, 60),
    skills: list(r?.skills, 10, 40),
    count: Math.max(1, Math.min(10, Math.round(Number(r?.count) || 1))),
    allocation: Math.max(10, Math.min(100, Math.round((Number(r?.allocation) || 100) / 10) * 10)),
  })).filter((r: BriefRole) => r.title);
  const otherCosts: OtherCost[] = [];
  for (const c of (Array.isArray(typed.otherCosts) ? typed.otherCosts : Array.isArray(ai?.otherCosts) ? ai.otherCosts : []).slice(0, 15)) {
    const amount = money(c?.amount);
    const label = clip(c?.label, 60);
    if (!label || amount === null) continue;
    if (!Array.isArray(typed.otherCosts) && source && !amountInText(amount, source)) { warnings.push(`"${label}" had an amount that is not in the document, so it was left out.`); continue; }
    otherCosts.push({ label, amount });
  }
  let startDate = isDate(typed.startDate) ? typed.startDate : isDate(ai?.startDate) ? ai.startDate : '';
  let endDate = isDate(typed.endDate) ? typed.endDate : isDate(ai?.endDate) ? ai.endDate : '';
  if (startDate && endDate && endDate < startDate) { warnings.push('The end date was before the start date, so it was cleared.'); endDate = ''; }
  if (startDate && startDate < addDays(today, -365)) { warnings.push('The start date was more than a year ago, so it was cleared.'); startDate = ''; }
  const b: Brief = {
    name: clip(typed.name, 80) || clip(ai?.name, 80) || 'New project',
    summary: clip(typed.summary, 1200) || clip(ai?.summary, 1200),
    goals: list(ai?.goals, 10),
    deliverables: list(ai?.deliverables, 15),
    startDate, endDate,
    budget: pickMoney('budget', 'budget'),
    clientPrice: pickMoney('clientPrice', 'client price'),
    otherCosts, roles,
    constraints: list(typed.constraints ?? ai?.constraints, 10),
    warnings,
  };
  if (!b.roles.length) b.warnings.push('No roles were found. Add the roles the project needs before building the plan.');
  if (!b.startDate || !b.endDate) b.warnings.push('Add a start date and a deadline before building the plan.');
  if (b.budget === null) b.warnings.push('No budget was given. The plan can still be built; budget checks are skipped.');
  return b;
}

/** A brief the person edited on screen. Same rules, no AI, no source check (they typed it). */
export function editBrief(input: any, today: string): Brief {
  const b = cleanBrief(input, {
    name: input?.name, summary: input?.summary, budget: input?.budget, clientPrice: input?.clientPrice, startDate: input?.startDate, endDate: input?.endDate,
    otherCosts: Array.isArray(input?.otherCosts) ? input.otherCosts : [], constraints: input?.constraints,
  }, '', today);
  return b;
}

/** Why the plan cannot be built yet, or ''. */
export function briefProblem(b: Brief): string {
  if (!b.roles.length) return 'Add at least one role the project needs.';
  if (!isDate(b.startDate) || !isDate(b.endDate)) return 'Add a start date and a deadline.';
  if (b.endDate < b.startDate) return 'The deadline is before the start date.';
  if (workingDays(b.startDate, b.endDate) < 3) return 'The project must run at least 3 working days.';
  if (workingDays(b.startDate, b.endDate) > 520) return 'Plans longer than two years are not supported. Split the project.';
  return '';
}

// ------------------------------------------------------------------ skills

export type SkillSource = 'confirmed' | 'submitted' | 'suggested';
export interface Skill { name: string; level: 1 | 2 | 3 }
export interface PersonSkills { skills: Skill[]; source: SkillSource }

const ALIASES: Record<string, string> = {
  js: 'javascript', ts: 'typescript', rn: 'react native', reactjs: 'react', 'react.js': 'react', node: 'node.js', nodejs: 'node.js',
  'ui/ux': 'ui ux design', 'ux/ui': 'ui ux design', ux: 'ux design', ui: 'ui design', qa: 'testing', 'quality assurance': 'testing',
  ml: 'machine learning', ai: 'artificial intelligence', seo: 'search engine optimisation', pm: 'project management', gcp: 'google cloud', k8s: 'kubernetes',
  excel: 'ms excel', 'ms-excel': 'ms excel', accounts: 'accounting', postgres: 'postgresql', mongo: 'mongodb',
};
export function normSkill(s: unknown): string {
  const t = clip(s, 60).toLowerCase().replace(/[^a-z0-9+#./ ]/g, ' ').replace(/\s+/g, ' ').trim();
  return ALIASES[t] || t;
}
export const cleanSkills = (v: unknown): Skill[] => {
  const out = new Map<string, Skill>();
  for (const x of (Array.isArray(v) ? v : []).slice(0, 40)) {
    const name = clip(typeof x === 'string' ? x : x?.name, 40);
    const key = normSkill(name);
    if (!key || key.length < 2) continue;
    const level = Math.max(1, Math.min(3, Math.round(Number(typeof x === 'string' ? 2 : x?.level) || 2))) as 1 | 2 | 3;
    if (!out.has(key) || out.get(key)!.level < level) out.set(key, { name, level });
  }
  return [...out.values()].slice(0, 30);
};

/** Starter skills by job title, used only as suggestions until the person fills in their own. */
const TITLE_SKILLS: [RegExp, string[]][] = [
  [/react native|mobile|android|ios|flutter/i, ['Mobile apps', 'React Native', 'REST APIs']],
  [/front.?end|react|ui developer/i, ['React', 'JavaScript', 'TypeScript', 'CSS']],
  [/back.?end|node|api|server/i, ['Node.js', 'REST APIs', 'Databases']],
  [/full.?stack/i, ['React', 'Node.js', 'JavaScript', 'Databases']],
  [/software|developer|engineer|programmer/i, ['Programming', 'Git', 'Problem solving']],
  [/data (analyst|scientist)|analytics|bi /i, ['Data analysis', 'SQL', 'MS Excel']],
  [/designer|ui|ux|graphic/i, ['UI design', 'Figma', 'Prototyping']],
  [/qa|test|quality/i, ['Testing', 'Test plans', 'Bug tracking']],
  [/devops|cloud|infra|sre/i, ['Cloud', 'CI/CD', 'Linux']],
  [/project manager|program manager|scrum|delivery/i, ['Project management', 'Planning', 'Stakeholder management']],
  [/product manager|product owner/i, ['Product management', 'Roadmapping', 'User research']],
  [/market|seo|content|social/i, ['Digital marketing', 'Content writing', 'Social media']],
  [/sales|business development|account manager/i, ['Sales', 'Negotiation', 'CRM']],
  [/hr|human resource|recruit|talent/i, ['Recruitment', 'HR operations', 'Employee relations']],
  [/account|finance|audit|tax/i, ['Accounting', 'MS Excel', 'Taxation']],
  [/video|editor|motion|camera|videograph/i, ['Video editing', 'Premiere Pro', 'Storytelling']],
  [/support|customer|service desk/i, ['Customer support', 'Communication', 'Ticketing tools']],
];
export function suggestSkills(title: string, certs: string[] = [], needs: string[] = []): Skill[] {
  const names: string[] = [];
  for (const [re, skills] of TITLE_SKILLS) if (re.test(title || '')) names.push(...skills);
  for (const c of certs) names.push(c);
  const out = cleanSkills(names.map((n) => ({ name: n, level: 2 })));
  // Training needs are things the person is learning: level 1.
  return cleanSkills([...out, ...needs.map((n) => ({ name: n, level: 1 }))]).slice(0, 12);
}

const matches = (a: string, b: string) => a === b || (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)));
const SOURCE_WEIGHT: Record<SkillSource, number> = { confirmed: 1, submitted: 0.85, suggested: 0.5 };
const LEVEL_WEIGHT = { 1: 0.6, 2: 0.85, 3: 1 };

/** 0-100 fit of a person to a role, plus which role skills they have and which they lack. */
export function skillFit(role: Pick<BriefRole, 'title' | 'skills'>, person: { title?: string } & PersonSkills): { fit: number; matched: string[]; missing: string[] } {
  const mine = person.skills.map((s) => ({ ...s, key: normSkill(s.name) }));
  const titleWords = (role.title || '').toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !['and', 'the', 'senior', 'junior', 'lead'].includes(w));
  const titleHit = titleWords.some((w) => (person.title || '').toLowerCase().includes(w));
  const wanted = role.skills.map((s) => ({ name: s, key: normSkill(s) })).filter((s) => s.key);
  if (!wanted.length) return { fit: titleHit ? 65 : 20, matched: [], missing: [] };
  const matched: string[] = [];
  const missing: string[] = [];
  let total = 0;
  for (const w of wanted) {
    const best = mine.filter((m) => matches(m.key, w.key)).reduce((v, m) => Math.max(v, LEVEL_WEIGHT[m.level]), 0);
    if (best > 0) { matched.push(w.name); total += best * SOURCE_WEIGHT[person.source]; } else missing.push(w.name);
  }
  const fit = Math.min(100, Math.round((total / wanted.length) * 100 + (titleHit ? 8 : 0)));
  return { fit, matched, missing };
}

// ------------------------------------------------------------------ availability and the team match

export interface Candidate {
  uid: string;
  name: string;
  title: string;
  department: string;
  skills: Skill[];
  skillSource: SkillSource;
  /** null when no salary structure exists. Never sent to the AI. */
  annualCtc: number | null;
  /** Approved leave days inside the project window. */
  leaveDays: number;
  /** Highest % already allocated to other approved projects during the window. */
  allocatedPct: number;
  /** Set when the person leaves before the project ends. */
  lastWorkingDay?: string;
}
export interface Assignment {
  key: string;
  role: string;
  roleIndex: number;
  uid: string;
  name: string;
  title: string;
  allocation: number;
  fit: number;
  matched: string[];
  missing: string[];
  skillSource: SkillSource | '';
  notes: string[];
  alternatives: { uid: string; name: string; fit: number; free: number }[];
}

export const DAYS_PER_YEAR = 260;
export const dailyCost = (annualCtc: number | null) => (annualCtc && annualCtc > 0 ? Math.round(annualCtc / DAYS_PER_YEAR) : null);

/** Picks people for every role: skill fit first, then who is free, then cost. One person is never booked over 100% in a plan. */
export function matchTeam(brief: Brief, people: Candidate[]): Assignment[] {
  const workdays = workingDays(brief.startDate, brief.endDate);
  const usable = people.filter((p) => !p.lastWorkingDay || p.lastWorkingDay >= brief.endDate);
  const costs = usable.map((p) => dailyCost(p.annualCtc)).filter((x): x is number => x !== null);
  const [lo, hi] = [Math.min(...costs, 0), Math.max(...costs, 1)];
  const booked = new Map<string, number>();
  const out: Assignment[] = [];
  brief.roles.forEach((role, roleIndex) => {
    const scored = usable.map((p) => {
      const f = skillFit(role, { title: p.title, skills: p.skills, source: p.skillSource });
      const free = Math.max(0, 100 - p.allocatedPct - (booked.get(p.uid) || 0));
      const availability = (free / 100) * (workdays ? Math.max(0, 1 - p.leaveDays / workdays) : 1);
      const d = dailyCost(p.annualCtc);
      const costScore = d === null ? 50 : hi > lo ? 100 * (1 - (d - lo) / (hi - lo)) : 100;
      return { p, f, free, score: 0.6 * f.fit + 0.3 * availability * 100 + 0.1 * costScore };
    }).sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
    for (let i = 0; i < role.count; i++) {
      const pick = scored.find((s) => s.free >= Math.min(role.allocation, 50) && s.f.fit >= 15 && !out.some((o) => o.roleIndex === roleIndex && o.uid === s.p.uid));
      const key = `${roleIndex}_${i}`;
      const alternatives = scored.filter((s) => s !== pick && s.f.fit >= 15 && s.free > 0).slice(0, 3).map((s) => ({ uid: s.p.uid, name: s.p.name, fit: s.f.fit, free: s.free }));
      if (!pick) {
        out.push({ key, role: role.title, roleIndex, uid: '', name: '', title: '', allocation: role.allocation, fit: 0, matched: [], missing: role.skills, skillSource: '', notes: ['Nobody free with the skills for this role. Hire, use a contractor, or change the role.'], alternatives });
        continue;
      }
      const allocation = Math.min(role.allocation, pick.free);
      booked.set(pick.p.uid, (booked.get(pick.p.uid) || 0) + allocation);
      pick.free -= allocation;
      out.push(assignmentFor(key, role, roleIndex, pick.p, allocation, pick.f, alternatives));
    }
  });
  return out;
}

function assignmentFor(key: string, role: BriefRole, roleIndex: number, p: Candidate, allocation: number, f: ReturnType<typeof skillFit>, alternatives: Assignment['alternatives']): Assignment {
  const notes: string[] = [];
  if (allocation < role.allocation) notes.push(`Only ${allocation}% free (role asks for ${role.allocation}%).`);
  if (p.leaveDays > 0) notes.push(`${p.leaveDays} day${p.leaveDays === 1 ? '' : 's'} of approved leave in this window.`);
  if (p.skillSource === 'suggested') notes.push('Skills are guessed from the job title; ask them to fill in their skills.');
  if (p.annualCtc === null) notes.push('No salary structure, so this person\'s cost is not counted.');
  return { key, role: role.title, roleIndex, uid: p.uid, name: p.name, title: p.title, allocation, fit: f.fit, matched: f.matched, missing: f.missing, skillSource: p.skillSource, notes, alternatives };
}

/** Puts someone else on one seat (the person's choice on screen). */
export function swapAssignment(brief: Brief, team: Assignment[], key: string, p: Candidate, allocation?: number): Assignment[] | string {
  const seat = team.find((a) => a.key === key);
  if (!seat) return 'That role is not in this plan.';
  if (p.lastWorkingDay && p.lastWorkingDay < brief.endDate) return `${p.name} leaves on ${p.lastWorkingDay}, before the project ends.`;
  const role = brief.roles[seat.roleIndex];
  const elsewhere = team.filter((a) => a.key !== key && a.uid === p.uid).reduce((n, a) => n + a.allocation, 0);
  const free = Math.max(0, 100 - p.allocatedPct - elsewhere);
  if (free <= 0) return `${p.name} has no free time in this window.`;
  const want = Math.max(10, Math.min(100, Math.round((allocation ?? seat.allocation) / 10) * 10));
  const f = skillFit(role, { title: p.title, skills: p.skills, source: p.skillSource });
  return team.map((a) => (a.key === key ? assignmentFor(key, role, seat.roleIndex, p, Math.min(want, free), f, seat.alternatives.filter((x) => x.uid !== p.uid)) : a));
}

// ------------------------------------------------------------------ the AI's plan, checked

export interface Phase { name: string; startWeek: number; weeks: number; startDate: string; endDate: string }
export interface PlanTask { key: string; title: string; description: string; phase: string; role: string; assignmentKey: string; ownerUid: string; ownerName: string; days: number; startDate: string; dueDate: string }
export interface Risk { level: 'High' | 'Medium' | 'Low'; title: string; body: string; fix: string }
export interface PlanBody { summary: string; phases: Phase[]; milestones: { week: number; date: string; label: string }[]; tasks: PlanTask[]; risks: Risk[] }

const MONEY_WORDS = /₹|\brs\.?\s*\d|\binr\b|\blakhs?\b|\blacs?\b|\bcrores?\b|\$\s*\d|\bbudget of\b/i;
const noMoney = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => !MONEY_WORDS.test(x)).join(' ').trim();

/** Turns the AI's draft into a plan with real dates and owners. Anything that does not fit is dropped or clamped. */
export function checkPlan(ai: any, brief: Brief, team: Assignment[]): PlanBody {
  const W = weeksOf(brief.startDate, brief.endDate);
  const weekStart = (w: number) => addDays(brief.startDate, (w - 1) * 7);
  const endOf = (startWeek: number, weeks: number) => { const e = addDays(weekStart(startWeek + weeks - 1), 6); return e > brief.endDate ? brief.endDate : e; };
  const phases: Phase[] = [];
  for (const p of (Array.isArray(ai?.phases) ? ai.phases : []).slice(0, 10)) {
    const name = clip(p?.name, 40);
    if (!name || phases.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    const startWeek = Math.max(1, Math.min(W, Math.round(Number(p?.startWeek) || 1)));
    const weeks = Math.max(1, Math.min(W - startWeek + 1, Math.round(Number(p?.weeks) || 1)));
    phases.push({ name, startWeek, weeks, startDate: weekStart(startWeek), endDate: endOf(startWeek, weeks) });
  }
  if (!phases.length) phases.push({ name: 'Delivery', startWeek: 1, weeks: W, startDate: brief.startDate, endDate: brief.endDate });
  phases.sort((a, b) => a.startWeek - b.startWeek);

  const seatsByRole = new Map<string, Assignment[]>();
  for (const a of team) { const k = a.role.toLowerCase(); seatsByRole.set(k, [...(seatsByRole.get(k) || []), a]); }
  const turn = new Map<string, number>();
  const tasks: PlanTask[] = [];
  for (const t of (Array.isArray(ai?.tasks) ? ai.tasks : []).slice(0, 80)) {
    const title = clip(t?.title, 160);
    if (title.length < 3) continue;
    const phase = phases.find((p) => p.name.toLowerCase() === clip(t?.phase, 40).toLowerCase()) || phases[0];
    const roleKey = clip(t?.role, 60).toLowerCase();
    const seats = seatsByRole.get(roleKey) || [...seatsByRole.entries()].find(([k]) => matches(k, roleKey))?.[1] || team;
    const n = turn.get(roleKey) || 0;
    turn.set(roleKey, n + 1);
    const seat = seats.length ? seats[n % seats.length] : null;
    tasks.push({
      key: `t${tasks.length + 1}`, title, description: clip(t?.description, 600), phase: phase.name, role: seat?.role || clip(t?.role, 60),
      assignmentKey: seat?.key || '', ownerUid: seat?.uid || '', ownerName: seat?.name || '',
      days: Math.max(0.5, Math.min(40, Math.round((Number(t?.days) || 1) * 2) / 2)), startDate: phase.startDate, dueDate: phase.endDate,
    });
  }
  const milestones = (Array.isArray(ai?.milestones) ? ai.milestones : []).slice(0, 8).map((m: any) => {
    const week = Math.max(1, Math.min(W, Math.round(Number(m?.week) || W)));
    return { week, date: endOf(week, 1), label: clip(m?.label, 80) };
  }).filter((m: any) => m.label).sort((a: any, b: any) => a.week - b.week);
  const LEVEL: Record<string, Risk['level']> = { high: 'High', medium: 'Medium', low: 'Low' };
  const risks: Risk[] = (Array.isArray(ai?.risks) ? ai.risks : []).slice(0, 6).map((r: any) => ({
    level: LEVEL[clip(r?.level, 10).toLowerCase()] || 'Medium', title: clip(r?.title, 80), body: noMoney(clip(r?.body, 300)), fix: noMoney(clip(r?.fix, 300)),
  })).filter((r: Risk) => r.title);
  return { summary: noMoney(clip(ai?.summary, 800)), phases, milestones, tasks, risks };
}

// ------------------------------------------------------------------ money and health (never the AI)

export interface PersonCost { key: string; uid: string; name: string; role: string; allocation: number; days: number; dailyCost: number | null; cost: number | null }
export interface Costs {
  workdays: number;
  weeks: number;
  people: PersonCost[];
  peopleTotal: number;
  otherTotal: number;
  total: number;
  budget: number | null;
  headroom: number | null;
  clientPrice: number | null;
  profit: number | null;
  margin: number | null;
  byPhase: { name: string; amount: number }[];
  byRole: { role: string; amount: number }[];
  missingSalary: number;
}

export function costPlan(brief: Brief, team: Assignment[], plan: PlanBody, ctc: Map<string, number | null>): Costs {
  const workdays = workingDays(brief.startDate, brief.endDate);
  const people: PersonCost[] = team.filter((a) => a.uid).map((a) => {
    const d = dailyCost(ctc.get(a.uid) ?? null);
    const days = round2((workdays * a.allocation) / 100);
    return { key: a.key, uid: a.uid, name: a.name, role: a.role, allocation: a.allocation, days, dailyCost: d, cost: d === null ? null : Math.round(d * days) };
  });
  const peopleTotal = people.reduce((n, p) => n + (p.cost || 0), 0);
  const otherTotal = brief.otherCosts.reduce((n, c) => n + c.amount, 0);
  const total = peopleTotal + otherTotal;
  // Each person's cost goes to phases in proportion to their task days there; without tasks, by phase length.
  const phaseAmt = new Map(plan.phases.map((p) => [p.name, 0]));
  const totalWeeks = plan.phases.reduce((n, p) => n + p.weeks, 0) || 1;
  for (const p of people) {
    if (!p.cost) continue;
    const mine = plan.tasks.filter((t) => t.assignmentKey === p.key);
    const sum = mine.reduce((n, t) => n + t.days, 0);
    for (const ph of plan.phases) {
      const share = sum ? mine.filter((t) => t.phase === ph.name).reduce((n, t) => n + t.days, 0) / sum : ph.weeks / totalWeeks;
      phaseAmt.set(ph.name, (phaseAmt.get(ph.name) || 0) + p.cost * share);
    }
  }
  for (const ph of plan.phases) phaseAmt.set(ph.name, (phaseAmt.get(ph.name) || 0) + otherTotal * (ph.weeks / totalWeeks));
  const byPhase = plan.phases.map((ph) => ({ name: ph.name, amount: Math.round(phaseAmt.get(ph.name) || 0) }));
  // Rounding: the phase amounts add up to the total exactly.
  const diff = total - byPhase.reduce((n, p) => n + p.amount, 0);
  if (byPhase.length && diff) byPhase[byPhase.length - 1].amount += diff;
  const roleAmt = new Map<string, number>();
  for (const p of people) roleAmt.set(p.role, (roleAmt.get(p.role) || 0) + (p.cost || 0));
  const profit = brief.clientPrice !== null ? brief.clientPrice - total : null;
  return {
    workdays, weeks: weeksOf(brief.startDate, brief.endDate), people, peopleTotal, otherTotal, total,
    budget: brief.budget, headroom: brief.budget !== null ? brief.budget - total : null,
    clientPrice: brief.clientPrice, profit, margin: profit !== null && brief.clientPrice ? round2((profit / brief.clientPrice) * 100) : null,
    byPhase, byRole: [...roleAmt.entries()].map(([role, amount]) => ({ role, amount })).sort((a, b) => b.amount - a.amount),
    missingSalary: people.filter((p) => p.cost === null).length,
  };
}

export interface Health { tone: 'good' | 'warn' | 'bad'; title: string; body: string }

export function healthChecks(brief: Brief, team: Assignment[], plan: PlanBody, costs: Costs): Health[] {
  const out: Health[] = [];
  if (costs.budget !== null) {
    out.push(costs.headroom! >= 0
      ? { tone: 'good', title: 'Within budget', body: `${inr(costs.headroom)} left after people and other costs.` }
      : { tone: 'bad', title: 'Over budget', body: `Planned cost is ${inr(-costs.headroom!)} more than the budget. Lower allocations, swap people or cut scope.` });
  }
  if (costs.margin !== null) {
    out.push(costs.profit! < 0
      ? { tone: 'bad', title: 'Loss at this price', body: `The project loses ${inr(-costs.profit!)} at the client price.` }
      : { tone: costs.margin < 15 ? 'warn' : 'good', title: costs.margin < 15 ? 'Thin margin' : 'Healthy margin', body: `${costs.margin}% margin (${inr(costs.profit)} profit).` });
  }
  const gaps = team.filter((a) => !a.uid || a.fit < 50);
  if (gaps.length) out.push({ tone: 'warn', title: `${gaps.length} skill gap${gaps.length === 1 ? '' : 's'}`, body: gaps.map((g) => (g.uid ? `${g.role}: ${g.name} is a ${g.fit}% fit${g.missing.length ? ` (missing ${g.missing.slice(0, 3).join(', ')})` : ''}` : `${g.role}: nobody found`)).join('; ') });
  const over: string[] = [];
  for (const a of team.filter((x) => x.uid)) {
    const have = (costs.workdays * a.allocation) / 100;
    const need = plan.tasks.filter((t) => t.assignmentKey === a.key).reduce((n, t) => n + t.days, 0);
    if (need > have * 1.1) over.push(`${a.name} has ${round2(need)} task days in ${round2(have)} available`);
  }
  out.push(over.length ? { tone: 'warn', title: 'Deadline is tight', body: `${over.join('; ')}.` } : { tone: 'good', title: 'Work fits the time', body: 'Everyone\'s tasks fit inside their allocated days.' });
  const leave = team.filter((a) => a.notes.some((n) => n.includes('approved leave')));
  out.push(leave.length ? { tone: 'warn', title: 'Leave during the project', body: leave.map((a) => a.name).join(', ') + ' have approved leave in this window.' } : { tone: 'good', title: 'No leave clashes', body: 'Nobody on the team has approved leave in this window.' });
  if (costs.missingSalary) out.push({ tone: 'warn', title: 'Costs are incomplete', body: `${costs.missingSalary} team member${costs.missingSalary === 1 ? ' has' : 's have'} no salary structure, so their cost is not counted.` });
  const guessed = team.filter((a) => a.skillSource === 'suggested').length;
  if (guessed) out.push({ tone: 'warn', title: 'Skills partly guessed', body: `${guessed} match${guessed === 1 ? ' is' : 'es are'} based on job titles. Matches improve when people fill in My skills.` });
  return out;
}

/** The figures the plan headline states. Built here so the words never disagree with the numbers. */
export function moneyLine(costs: Costs, teamSize: number): string {
  const parts = [`${teamSize} ${teamSize === 1 ? 'person' : 'people'} over ${costs.weeks} week${costs.weeks === 1 ? '' : 's'}, planned cost ${inr(costs.total)}`];
  if (costs.headroom !== null) parts.push(costs.headroom >= 0 ? `${inr(costs.headroom)} under budget` : `${inr(-costs.headroom)} over budget`);
  if (costs.profit !== null) parts.push(`${inr(costs.profit)} profit (${costs.margin}% margin) at the client price`);
  return `${parts.join(', ')}.`;
}

/** What someone without payroll access is shown: totals only, no one's daily cost or personal cost. */
export function hidePersonalCost(costs: Costs): Costs {
  return { ...costs, people: costs.people.map((p) => ({ ...p, dailyCost: null, cost: null })), byRole: [] };
}
