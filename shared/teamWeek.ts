/**
 * A manager's week at a glance: who is away, which days are busiest, what is waiting for their decision.
 * Everything here is counted in code. The AI (when on) only writes the one short opening paragraph from these facts,
 * and a plain sentence built here is used if it is off or writes anything the facts do not contain.
 */
import { addDays } from './leaveEngine.js';

const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = (iso: string) => `${WK[dow(iso)]} ${parseInt(iso.slice(8, 10), 10)} ${MO[parseInt(iso.slice(5, 7), 10) - 1]}`;

export interface WeekMember { uid: string; name: string; isOff: (date: string) => boolean; requests: { from: string; to: string; status: string }[] }
export interface WaitingReq { id: string; name: string; typeName: string; from: string; to: string; days: number; waitingDays: number }
export interface PersonWeek { uid: string; name: string; days: string[]; pending: boolean }
export interface TeamWeek {
  weekStart: string; weekEnd: string; nextStart: string; nextEnd: string; size: number; limitPct: number;
  thisWeek: PersonWeek[]; nextWeek: PersonWeek[]; waiting: WaitingReq[];
  busiest: { day: string; away: number } | null; overLimit: { day: string; away: number }[];
}

/** The Monday of the week being summarised: this week on Monday to Friday, the coming week on a weekend. */
export const weekStartFor = (today: string) => { const d = dow(today); return d === 6 ? addDays(today, 2) : d === 0 ? addDays(today, 1) : addDays(today, -(d - 1)); };

function personWeeks(members: WeekMember[], start: string): PersonWeek[] {
  const out: PersonWeek[] = [];
  for (const m of members) {
    const days: string[] = []; let pending = false;
    for (let i = 0; i < 5; i++) {
      const day = addDays(start, i);
      if (m.isOff(day)) continue;
      const hit = m.requests.filter((r) => ['APPROVED', 'PENDING'].includes(r.status) && r.from <= day && day <= r.to);
      if (!hit.length) continue;
      days.push(day);
      if (hit.every((r) => r.status === 'PENDING')) pending = true;
    }
    if (days.length) out.push({ uid: m.uid, name: m.name, days, pending });
  }
  return out.sort((a, b) => a.days[0].localeCompare(b.days[0]) || a.name.localeCompare(b.name));
}

export function buildTeamWeek(today: string, members: WeekMember[], waiting: WaitingReq[], limitPct = 40): TeamWeek {
  const weekStart = weekStartFor(today), nextStart = addDays(weekStart, 7);
  const thisWeek = personWeeks(members, weekStart), nextWeek = personWeeks(members, nextStart);
  const size = members.length;
  const perDay = new Map<string, number>();
  for (const p of thisWeek) for (const d of p.days) perDay.set(d, (perDay.get(d) || 0) + 1);
  const counts = [...perDay].map(([day, away]) => ({ day, away })).sort((a, b) => b.away - a.away || a.day.localeCompare(b.day));
  const allowed = (size * limitPct) / 100;
  return {
    weekStart, weekEnd: addDays(weekStart, 4), nextStart, nextEnd: addDays(nextStart, 4), size, limitPct, thisWeek, nextWeek,
    waiting: [...waiting].sort((a, b) => b.waitingDays - a.waitingDays),
    busiest: counts[0] || null,
    overLimit: size >= 3 ? counts.filter((c) => c.away >= 2 && c.away > allowed).sort((a, b) => a.day.localeCompare(b.day)) : [],
  };
}

const span = (p: PersonWeek) => (p.days.length === 1 ? dayLabel(p.days[0]) : `${dayLabel(p.days[0])} to ${dayLabel(p.days[p.days.length - 1])}`) + (p.pending ? ' (not yet approved)' : '');

/** Nothing worth sending: nobody away, nothing waiting. */
export const quietWeek = (t: TeamWeek) => !t.thisWeek.length && !t.nextWeek.length && !t.waiting.length;

/** The facts as text. This is all the AI is given, and what the number check compares its words against. */
export function weekFacts(t: TeamWeek): string {
  const lines = [`Team of ${t.size} people. Week of ${dayLabel(t.weekStart)} to ${dayLabel(t.weekEnd)}.`];
  lines.push(t.thisWeek.length ? `On leave this week: ${t.thisWeek.map((p) => `${p.name} ${span(p)}`).join('; ')}.` : 'Nobody is on leave this week.');
  if (t.busiest && t.busiest.away > 1) lines.push(`Busiest day: ${dayLabel(t.busiest.day)} with ${t.busiest.away} of ${t.size} away.`);
  if (t.overLimit.length) lines.push(`Above the ${t.limitPct}% team limit on: ${t.overLimit.map((d) => `${dayLabel(d.day)} (${d.away} away)`).join(', ')}.`);
  lines.push(t.nextWeek.length ? `Next week (${dayLabel(t.nextStart)} to ${dayLabel(t.nextEnd)}): ${t.nextWeek.map((p) => `${p.name} ${span(p)}`).join('; ')}.` : 'Nobody has leave booked next week.');
  lines.push(t.waiting.length ? `Waiting for your decision: ${t.waiting.map((w) => `${w.name}, ${w.typeName}, ${dayLabel(w.from)}${w.to !== w.from ? ` to ${dayLabel(w.to)}` : ''}, waiting ${w.waitingDays} day${w.waitingDays === 1 ? '' : 's'}`).join('; ')}.` : 'Nothing is waiting for your decision.');
  return lines.join('\n');
}

/** A short opening sentence built without AI. */
export function basicIntro(t: TeamWeek): string {
  const away = t.thisWeek.length;
  const parts = [away ? `${away} of ${t.size} people have leave this week.` : 'Nobody has leave this week.'];
  if (t.overLimit.length) parts.push(`${dayLabel(t.overLimit[0].day)} is above the team limit with ${t.overLimit[0].away} away.`);
  if (t.waiting.length) parts.push(`${t.waiting.length} leave request${t.waiting.length === 1 ? ' is' : 's are'} waiting for your decision.`);
  return parts.join(' ');
}

export function weeklyEmail(manager: string, t: TeamWeek, intro: string): { subject: string; body: string } {
  return {
    subject: `Your team this week (${dayLabel(t.weekStart)})`,
    body: `Hello ${manager || 'there'},\n\n${intro}\n\n${weekFacts(t)}\n\nOpen Leave & Attendance, then Team this week, for the full picture.\n`,
  };
}
