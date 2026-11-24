/**
 * Professional services automation rules (pure, no I/O): weeks, timesheet entries, billing lines, utilisation.
 * Weeks run Monday to Sunday and are identified by their Monday ("weekStart", YYYY-MM-DD).
 */
export const MAX_DAY_HOURS = 24;
export const BILLING = ['TM', 'FIXED'] as const; // time and material, fixed fee
export type BillingKind = (typeof BILLING)[number];

const DAY = 86400_000;
const t = (d: string) => Date.parse(d + 'T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(t(v)) === v;

export const weekStart = (day: string): string => { const dow = (new Date(t(day)).getUTCDay() + 6) % 7; return iso(t(day) - dow * DAY); };
export const weekDays = (ws: string): string[] => Array.from({ length: 7 }, (_, i) => iso(t(ws) + i * DAY));
export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Entry { projectId: string; date: string; hours: number; note: string }

/** Validates a week of entries. Hours are quarter-hour steps; a day cannot exceed 24 hours across projects. */
export function cleanEntries(ws: string, raw: unknown, allowedProjects: Set<string>): { entries?: Entry[]; error?: string } {
  if (!Array.isArray(raw)) return { error: 'Entries must be a list.' };
  if (raw.length > 200) return { error: 'Too many entries for one week.' };
  const days = new Set(weekDays(ws)), merged = new Map<string, Entry>(), perDay = new Map<string, number>();
  for (const r of raw as any[]) {
    const hours = Number(r?.hours);
    if (!allowedProjects.has(String(r?.projectId))) return { error: 'You are not on one of those projects.' };
    if (!days.has(String(r?.date))) return { error: 'An entry is outside this week.' };
    if (!Number.isFinite(hours) || hours < 0 || hours > MAX_DAY_HOURS) return { error: 'Hours must be between 0 and 24.' };
    if (Math.abs(hours * 4 - Math.round(hours * 4)) > 1e-9) return { error: 'Hours go in steps of 15 minutes (0.25).' };
    if (hours === 0) continue;
    const key = `${r.projectId}|${r.date}`, prev = merged.get(key);
    merged.set(key, { projectId: r.projectId, date: r.date, hours: (prev?.hours || 0) + hours, note: String(r.note || prev?.note || '').slice(0, 300) });
  }
  for (const e of merged.values()) perDay.set(e.date, (perDay.get(e.date) || 0) + e.hours);
  for (const [d, h] of perDay) if (h > MAX_DAY_HOURS) return { error: `${d} adds up to more than 24 hours.` };
  return { entries: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.projectId.localeCompare(b.projectId)) };
}

export interface ProjectRates { defaultRate: number; roleRates?: Record<string, number> }
export const rateFor = (p: ProjectRates, uid: string) => { const r = p.roleRates?.[uid]; return typeof r === 'number' && r >= 0 ? r : p.defaultRate || 0; };

export interface SheetLite { id: string; uid: string; name: string; weekStart: string; status: string; entries: Entry[]; invoiced?: Record<string, string> }
export interface ProjectLite extends ProjectRates { id: string; clientId: string; name: string; billing: BillingKind; billable: boolean; fixedFee?: number; fixedBilled?: number }
export interface Line { projectId: string; projectName: string; uid: string; name: string; hours: number; rate: number; amount: number; sheetIds: string[] }

/**
 * What can be billed to a client for weeks starting in [from, to]: approved sheets, billable time-and-material projects,
 * entries not yet on an invoice. Returns lines grouped by project and person.
 */
export function billableLines(sheets: SheetLite[], projects: ProjectLite[], clientId: string, from: string, to: string): Line[] {
  const byId = new Map(projects.filter((p) => p.clientId === clientId && p.billable && p.billing === 'TM').map((p) => [p.id, p]));
  const out = new Map<string, Line>();
  for (const s of sheets) {
    if (s.status !== 'APPROVED' || s.weekStart < from || s.weekStart > to) continue;
    for (const pid of new Set(s.entries.map((e) => e.projectId))) {
      const p = byId.get(pid);
      if (!p || s.invoiced?.[pid]) continue;
      const hours = round2(s.entries.filter((e) => e.projectId === pid).reduce((a, e) => a + e.hours, 0));
      const key = `${pid}|${s.uid}`, rate = rateFor(p, s.uid), cur = out.get(key) || { projectId: pid, projectName: p.name, uid: s.uid, name: s.name, hours: 0, rate, amount: 0, sheetIds: [] };
      cur.hours = round2(cur.hours + hours); cur.amount = round2(cur.hours * rate); cur.sheetIds.push(s.id);
      out.set(key, cur);
    }
  }
  return [...out.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name));
}

export const totals = (lines: { amount: number }[], taxPct: number) => {
  const subtotal = round2(lines.reduce((a, l) => a + l.amount, 0)), tax = round2((subtotal * taxPct) / 100);
  return { subtotal, tax, total: round2(subtotal + tax) };
};

export interface Allocation { uid: string; projectId: string; hoursPerWeek: number; from: string; to: string }
/** Planned hours per person for a week from allocations that overlap it, set against a capacity. */
export function plannedLoad(allocs: Allocation[], ws: string, capacity = 40): { uid: string; planned: number; capacity: number; free: number; over: boolean }[] {
  const we = weekDays(ws)[6], by = new Map<string, number>();
  for (const a of allocs) if (a.from <= we && a.to >= ws) by.set(a.uid, (by.get(a.uid) || 0) + a.hoursPerWeek);
  return [...by].map(([uid, planned]) => ({ uid, planned: round2(planned), capacity, free: round2(capacity - planned), over: planned > capacity })).sort((a, b) => a.uid.localeCompare(b.uid));
}

/** Logged hours for a person across sheets with a status in `counts`, split into billable and non-billable projects. */
export function loggedHours(sheets: SheetLite[], projects: ProjectLite[], counts = ['SUBMITTED', 'APPROVED']) {
  const bill = new Map(projects.map((p) => [p.id, p.billable])), out = new Map<string, { uid: string; name: string; billable: number; other: number }>();
  for (const s of sheets) {
    if (!counts.includes(s.status)) continue;
    const cur = out.get(s.uid) || { uid: s.uid, name: s.name, billable: 0, other: 0 };
    for (const e of s.entries) bill.get(e.projectId) ? (cur.billable += e.hours) : (cur.other += e.hours);
    out.set(s.uid, cur);
  }
  return [...out.values()].map((r) => ({ ...r, billable: round2(r.billable), other: round2(r.other), utilisation: r.billable + r.other ? Math.round((r.billable / (r.billable + r.other)) * 100) : 0 })).sort((a, b) => a.name.localeCompare(b.name));
}
