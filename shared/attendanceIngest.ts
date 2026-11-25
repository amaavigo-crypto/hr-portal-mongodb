/**
 * Turning raw punch logs (from a biometric device, a door controller, or a CSV export) into attendance days.
 * Pure functions, no database. Times without a zone are read as Indian Standard Time.
 *
 * A log line is: employee id, time, and optionally a direction (IN / OUT). When the direction is missing (most
 * device exports), punches of a day are paired in time order: first is in, second is out, third is in again, and so on.
 * Applying the same log twice changes nothing, and punches already on a day (self check-in, earlier imports) are kept.
 */
import type { PunchSession } from './leaveEngine.js';

export const MAX_SESSIONS = 12;
/** A second scan this close to the previous one is a double read of the same punch. */
export const DEBOUNCE_MS = 2 * 60_000;

export type Dir = 'IN' | 'OUT' | '';
export interface RawPunch { empId: string; at: string; dir: Dir }
export interface Parsed { punches: RawPunch[]; problems: string[] }

const IST_MS = 5.5 * 3600_000;

/** One time as an ISO instant, or '' when it cannot be read. */
export function parseWhen(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  let y: number, mo: number, d: number, h: number, mi: number, sec: number, zone: string | undefined;
  if (m) { [y, mo, d, h, mi, sec, zone] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), m[7]]; }
  else {
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
    if (!m) return '';
    [d, mo, y, h, mi, sec] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)];
    if (m[7]) { const pm = m[7].toUpperCase() === 'PM'; h = (h % 12) + (pm ? 12 : 0); }
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return '';
  const wall = Date.UTC(y, mo - 1, d, h, mi, sec);
  if (new Date(wall).getUTCMonth() !== mo - 1) return ''; // 31 February and the like
  let ms: number;
  if (!zone) ms = wall - IST_MS;
  else if (zone.toUpperCase() === 'Z') ms = wall;
  else { const sign = zone[0] === '-' ? -1 : 1; const z = zone.slice(1).replace(':', ''); ms = wall - sign * (+z.slice(0, 2) * 60 + +z.slice(2)) * 60_000; }
  return new Date(ms).toISOString();
}

export function parseDir(v: unknown): Dir {
  const s = String(v ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (['IN', 'I', 'CHECKIN', 'ENTRY', 'ENTER'].includes(s)) return 'IN';
  if (['OUT', 'O', 'CHECKOUT', 'EXIT', 'LEAVE'].includes(s)) return 'OUT';
  return '';
}

/** Splits one CSV line, honouring double quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const HEAD = {
  empId: ['empid', 'employeeid', 'employeecode', 'empcode', 'userid', 'id', 'code'],
  at: ['datetime', 'timestamp', 'time', 'punchtime', 'punchdatetime', 'logtime', 'at'],
  date: ['date', 'punchdate', 'logdate'],
  dir: ['direction', 'dir', 'type', 'inout', 'punchtype', 'status'],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const find = (head: string[], names: string[]) => head.findIndex((h) => names.includes(norm(h)));

/** CSV with a header row. Columns: employee id, a date-time (or a date and a time column), and optionally a direction. */
export function parseCsv(text: string, maxRows = 20000): Parsed {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const problems: string[] = [];
  if (lines.length < 2) return { punches: [], problems: ['The file has no rows.'] };
  const head = splitCsvLine(lines[0]);
  const iId = find(head, HEAD.empId), iAt = find(head, HEAD.at), iDate = find(head, HEAD.date), iDir = find(head, HEAD.dir);
  if (iId < 0 || (iAt < 0 && iDate < 0)) return { punches: [], problems: ['The first row must name an employee id column and a date-time column (for example: Employee ID, Date Time, Direction).'] };
  if (lines.length - 1 > maxRows) problems.push(`Only the first ${maxRows} rows were read.`);
  const punches: RawPunch[] = [];
  lines.slice(1, maxRows + 1).forEach((line, i) => {
    const c = splitCsvLine(line);
    const raw = iAt >= 0 && iDate !== iAt ? (iDate >= 0 && !/\d[ T]\d/.test(c[iAt] || '') ? `${c[iDate]} ${c[iAt]}` : c[iAt]) : iAt >= 0 ? c[iAt] : c[iDate];
    const at = parseWhen(raw);
    const empId = (c[iId] || '').trim();
    if (!empId || !at) { if (problems.length < 20) problems.push(`Row ${i + 2}: could not read the employee id or the time.`); return; }
    punches.push({ empId, at, dir: iDir >= 0 ? parseDir(c[iDir]) : '' });
  });
  return { punches, problems };
}

/** JSON body of a device or gateway: [{ empId, time, direction? }]. Accepts a few common key names. */
export function parseJson(logs: unknown, maxRows = 5000): Parsed {
  const problems: string[] = [];
  if (!Array.isArray(logs)) return { punches: [], problems: ['Send "logs" as a list.'] };
  if (logs.length > maxRows) problems.push(`Only the first ${maxRows} entries were read.`);
  const punches: RawPunch[] = [];
  logs.slice(0, maxRows).forEach((x: any, i) => {
    const empId = String(x?.empId ?? x?.employeeId ?? x?.userId ?? x?.code ?? '').trim();
    const at = parseWhen(x?.time ?? x?.timestamp ?? x?.dateTime ?? x?.at);
    if (!empId || !at) { if (problems.length < 20) problems.push(`Entry ${i + 1}: could not read the employee id or the time.`); return; }
    punches.push({ empId, at, dir: parseDir(x?.direction ?? x?.dir ?? x?.type) });
  });
  return { punches, problems };
}

export const istDate = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);

interface Ev { at: string; dir: Dir; note?: string }

/**
 * Merge new punches into a day's existing sessions. Returns the new sessions (never more than MAX_SESSIONS).
 * Existing sessions are kept as they are; new punches that are already there (same minute) are ignored.
 */
export function mergePunches(existing: PunchSession[], fresh: { at: string; dir: Dir }[]): { sessions: PunchSession[]; added: number; ignored: number } {
  const known = new Set<string>();
  const minute = (iso: string) => iso.slice(0, 16);
  existing.forEach((s) => { known.add(minute(s.in)); if (s.out) known.add(minute(s.out)); });
  const evs: Ev[] = [];
  let ignored = 0;
  for (const f of [...fresh].sort((a, b) => a.at.localeCompare(b.at))) {
    if (known.has(minute(f.at))) { ignored++; continue; }
    const prev = evs[evs.length - 1];
    if (prev && prev.dir === f.dir && new Date(f.at).getTime() - new Date(prev.at).getTime() < DEBOUNCE_MS) { ignored++; continue; }
    known.add(minute(f.at));
    evs.push({ at: f.at, dir: f.dir });
  }
  if (!evs.length) return { sessions: existing.map((s) => ({ ...s })), added: 0, ignored };

  // Build on top of what is there: a new punch falls into an open session, extends the day, or starts a new session.
  const sessions: PunchSession[] = existing.map((s) => ({ ...s }));
  let added = 0;
  for (const e of evs) {
    const last = sessions[sessions.length - 1];
    const open = last && !last.out ? last : null;
    // a punch inside a finished session is already covered by it
    if (sessions.some((x) => x.out && e.at >= x.in && e.at <= x.out)) { ignored++; continue; }
    const asIn = e.dir === 'IN' || (e.dir === '' && !open);
    if (asIn) {
      if (open) { ignored++; continue; } // already in
      if (sessions.length >= MAX_SESSIONS) { ignored++; continue; }
      // an "in" earlier than an already finished session cannot be placed after it; keep order by inserting
      const at = sessions.findIndex((s) => s.in > e.at);
      if (at >= 0) sessions.splice(at, 0, { in: e.at, out: null }); else sessions.push({ in: e.at, out: null });
      added++;
    } else {
      if (open) {
        if (e.at <= open.in) { ignored++; continue; }
        open.out = e.at; added++;
      } else {
        // an "out" with no open session: it closes a session that has no out yet, otherwise it is an orphan
        ignored++;
      }
    }
  }
  // sessions inserted before others may overlap; close any open session that is followed by another one at that start
  for (let i = 0; i < sessions.length - 1; i++) if (!sessions[i].out) { sessions[i].out = sessions[i + 1].in; }
  return { sessions, added, ignored };
}

/** Group parsed punches by person and IST date. */
export function groupPunches(punches: RawPunch[]): Map<string, Map<string, { at: string; dir: Dir }[]>> {
  const out = new Map<string, Map<string, { at: string; dir: Dir }[]>>();
  for (const p of punches) {
    const emp = p.empId.trim().toLowerCase();
    const day = istDate(p.at);
    if (!out.has(emp)) out.set(emp, new Map());
    const days = out.get(emp)!;
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push({ at: p.at, dir: p.dir });
  }
  return out;
}

/** Mirror fields stored beside `sessions`. */
export const dayFields = (sessions: PunchSession[]) => ({
  checkIn: sessions[0]?.in ?? null,
  checkOut: sessions.length && sessions[sessions.length - 1].out ? sessions[sessions.length - 1].out! : null,
});
