/**
 * Founders Dashboard feed: turns the portal's own numbers into the dashboard's "metrics contract v1"
 * (see the founder-dashboard repo, docs/CONTRACT.md).
 *
 * Pure: no database, no clock of its own. api/_lib/founderApi.ts loads the rows and calls buildMetrics.
 *
 * Privacy: counts and company names only. Nothing about a single employee ever goes in the payload.
 * Money (revenue and cost) is left out on purpose: the portal has plan labels but no prices, so the founders
 * enter revenue in the dashboard (POST /api/manual-money). Sending it from here as well would count it twice.
 */

export interface FounderCompany {
  id: string;
  name: string;
  status: string; // PENDING | ACTIVE | SUSPENDED
  plan: string;
  modules: string[];
  createdAt?: string;
  approvedAt?: string;
  updatedAt?: string;
}

/** Only these two fields of an employee are ever read. */
export interface FounderEmployee {
  companyId: string;
  active?: boolean;
}

/** One signed-in person's activity (collection `userActivity`, written by api/_lib/userActivity.ts). */
export interface FounderActivity {
  uid: string;
  companyId: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
}

export interface FounderInput {
  now: Date;
  companies: FounderCompany[];
  employees: FounderEmployee[];
  activity: FounderActivity[];
  moduleLabels: Record<string, string>;
}

export interface MetricsPayload {
  contract_version: 1;
  generated_at: string;
  labels: { customers: string; size: string; trend: string };
  customers: { total: number; new: number; churned: number };
  users: { active_daily: number; active_weekly: number; active_monthly: number };
  trend_value: number;
  attention: { level: 'info' | 'warn' | 'critical'; title: string }[];
  headline: { label: string; value: string }[];
  panel?: { title: string; rows: { label: string; value: string; pct: number }[] };
  customers_list: { name: string; plan: string; size: string; last_active: string; revenue: string; status: 'active' | 'quiet' | 'at_risk' }[];
}

const DAY = 86_400_000;
/** Contract limits (the dashboard rejects the whole payload if they are exceeded). */
export const LIMITS = { attention: 10, headline: 4, panelRows: 8, customers: 50 };
/** A company with no sign-in for this many days is "quiet"; for twice as long it is "at risk". */
export const QUIET_DAYS = 7;
export const AT_RISK_DAYS = 14;

const ms = (iso?: string): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
const num = (n: number) => n.toLocaleString('en-IN');
const title = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Trial');
const pct = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0);
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

export function lastActiveText(lastSeen: number | null, now: number): string {
  if (lastSeen === null) return 'Not seen yet';
  const age = now - lastSeen;
  if (age < DAY) return 'Today';
  if (age < 2 * DAY) return 'Yesterday';
  return `${Math.floor(age / DAY)} days ago`;
}

export function buildMetrics(input: FounderInput): MetricsPayload {
  const now = input.now.getTime();
  const active = input.companies.filter((c) => c.status === 'ACTIVE');
  const activeIds = new Set(active.map((c) => c.id));
  const pending = input.companies.filter((c) => c.status === 'PENDING');
  const suspended = input.companies.filter((c) => c.status === 'SUSPENDED');

  // ---- people per company (active employees of active companies only)
  const size = new Map<string, number>();
  for (const e of input.employees) {
    if (e.active === false || !activeIds.has(e.companyId)) continue;
    size.set(e.companyId, (size.get(e.companyId) || 0) + 1);
  }
  const employeesManaged = [...size.values()].reduce((a, b) => a + b, 0);

  // ---- activity
  const seenBy = new Map<string, number>(); // company -> latest sign-in
  let trackingSince: number | null = null;
  let daily = 0, weekly = 0, monthly = 0;
  const counted = new Set<string>();
  for (const a of input.activity) {
    const first = ms(a.firstSeenAt);
    if (first !== null && (trackingSince === null || first < trackingSince)) trackingSince = first;
    const last = ms(a.lastSeenAt);
    if (last === null || !activeIds.has(a.companyId)) continue;
    seenBy.set(a.companyId, Math.max(seenBy.get(a.companyId) || 0, last));
    if (counted.has(a.uid)) continue; // one person counts once, whatever company they last used
    counted.add(a.uid);
    const age = now - last;
    if (age <= DAY) daily++;
    if (age <= 7 * DAY) weekly++;
    if (age <= 30 * DAY) monthly++;
  }
  // Activity only exists from the day tracking began, so "no sign-in for 14 days" means nothing before that.
  const trackedDays = trackingSince === null ? 0 : (now - trackingSince) / DAY;
  const canJudgeQuiet = trackedDays >= AT_RISK_DAYS;

  // ---- the customer table
  type Row = MetricsPayload['customers_list'][number] & { _seen: number | null };
  const rows: Row[] = active.map((c) => {
    const seen = seenBy.get(c.id) ?? null;
    const approved = ms(c.approvedAt) ?? ms(c.createdAt);
    const youngCompany = approved !== null && now - approved < QUIET_DAYS * DAY;
    let status: Row['status'] = 'active';
    let lastActive = lastActiveText(seen, now);
    if (seen !== null) {
      const days = (now - seen) / DAY;
      status = days <= QUIET_DAYS ? 'active' : days <= AT_RISK_DAYS ? 'quiet' : 'at_risk';
    } else if (!canJudgeQuiet) {
      lastActive = trackedDays === 0 && trackingSince === null ? 'Not tracked yet' : 'Not seen yet';
    } else if (!youngCompany) {
      status = 'at_risk';
    }
    return {
      name: c.name || c.id, plan: title(c.plan), size: num(size.get(c.id) || 0), last_active: lastActive, revenue: '', status, _seen: seen,
    };
  });
  rows.sort((a, b) => (b._seen ?? -1) - (a._seen ?? -1) || a.name.localeCompare(b.name));
  const customersList = rows.slice(0, LIMITS.customers).map(({ _seen, ...r }) => r);

  // ---- new and gone in the last day
  const within = (iso?: string) => { const t = ms(iso); return t !== null && now - t <= DAY && now - t >= 0; };
  const newToday = active.filter((c) => within(c.approvedAt || c.createdAt)).length;
  const goneToday = suspended.filter((c) => within(c.updatedAt)).length;

  // ---- needs attention
  const attention: MetricsPayload['attention'] = [];
  if (pending.length) {
    const oldest = Math.min(...pending.map((c) => ms(c.createdAt) ?? now));
    const waiting = Math.floor((now - oldest) / DAY);
    attention.push({
      level: waiting >= 3 ? 'critical' : 'warn',
      title: `${plural(pending.length, 'company is', 'companies are')} waiting for approval${waiting >= 1 ? ` (longest ${plural(waiting, 'day', 'days')})` : ''}`,
    });
  }
  if (canJudgeQuiet) {
    const atRisk = rows.filter((r) => r.status === 'at_risk');
    if (atRisk.length) {
      const names = atRisk.slice(0, 3).map((r) => r.name).join(', ');
      attention.push({ level: 'warn', title: `${plural(atRisk.length, 'company has', 'companies have')} had no sign-ins for ${AT_RISK_DAYS}+ days: ${names}${atRisk.length > 3 ? ' and more' : ''}` });
    }
  }
  const empty = active.filter((c) => !size.get(c.id));
  if (empty.length) attention.push({ level: 'info', title: `${plural(empty.length, 'active company has', 'active companies have')} no employees added yet` });
  if (suspended.length) attention.push({ level: 'info', title: `${plural(suspended.length, 'company is', 'companies are')} suspended` });

  // ---- project panel: plans, then modules
  const panelRows: { label: string; value: string; pct: number }[] = [];
  if (active.length) {
    const byPlan = new Map<string, number>();
    for (const c of active) byPlan.set(title(c.plan), (byPlan.get(title(c.plan)) || 0) + 1);
    for (const [plan, n] of [...byPlan].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3)) {
      panelRows.push({ label: `${plan} plan`, value: `${n} of ${active.length}`, pct: pct(n, active.length) });
    }
    const byModule = new Map<string, number>();
    for (const c of active) for (const m of new Set(c.modules || [])) byModule.set(m, (byModule.get(m) || 0) + 1);
    for (const [key, n] of [...byModule].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      if (panelRows.length >= LIMITS.panelRows) break;
      panelRows.push({ label: input.moduleLabels[key] || key, value: `${n} of ${active.length}`, pct: pct(n, active.length) });
    }
  }

  const headline = [
    { label: 'Companies', value: num(active.length) },
    { label: 'Employees managed', value: num(employeesManaged) },
    { label: 'Active users (30 days)', value: num(monthly) },
    { label: 'Waiting for approval', value: num(pending.length) },
  ];

  return {
    contract_version: 1,
    generated_at: input.now.toISOString(),
    labels: { customers: 'Companies', size: 'Employees', trend: 'Daily active users' },
    customers: { total: active.length, new: newToday, churned: goneToday },
    users: { active_daily: daily, active_weekly: weekly, active_monthly: monthly },
    trend_value: daily,
    attention: attention.slice(0, LIMITS.attention),
    headline: headline.slice(0, LIMITS.headline),
    ...(panelRows.length ? { panel: { title: 'Companies by plan and module', rows: panelRows.slice(0, LIMITS.panelRows) } } : {}),
    customers_list: customersList,
  };
}
