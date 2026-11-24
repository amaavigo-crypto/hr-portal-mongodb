/**
 * When someone is reminded. One set of rules, used by the daily email job and by the Home "needs your attention" list,
 * so what Home shows and what the email says never disagree.
 */
import { daysBetween } from './leaveEngine.js';

export const RULES = {
  /** A policy waits this many days before the first nudge (people need time to read it). */
  ackWaitDays: 2,
  ackEvery: 3,
  /** A leave request or expense claim waiting this long is "overdue" for the approver. */
  approvalOverdueDays: 3,
  approvalEvery: 2,
  /** Home lists policies due for review this many days ahead; the email starts earlier, at reviewEmailDays. */
  reviewLeadDays: 30,
  reviewEmailDays: 14,
} as const;

export type ReminderKind = 'ACK' | 'CLAIM' | 'REVIEW';
export interface ReminderItem { key: string; kind: ReminderKind; text: string }

const since = (iso: string, today: string) => (iso ? daysBetween(iso.slice(0, 10), today) : 0);
const gap = (lastSent: string | undefined, today: string, every: number) => !lastSent || daysBetween(lastSent, today) >= every;

/** A policy the person has not acknowledged, waiting long enough to nudge. */
export const ackDue = (createdAt: string, today: string, lastSent?: string) => since(createdAt, today) >= RULES.ackWaitDays && gap(lastSent, today, RULES.ackEvery);

export const approvalOverdue = (createdAt: string, today: string, after: number = RULES.approvalOverdueDays) => since(createdAt, today) >= after;
export const claimDue = (createdAt: string, today: string, lastSent?: string) => approvalOverdue(createdAt, today) && gap(lastSent, today, RULES.approvalEvery);

/** Where a policy's review date stands: OVERDUE, SOON (inside the Home window) or nothing. */
export function reviewState(due: string, today: string, lead: number = RULES.reviewLeadDays): 'OVERDUE' | 'SOON' | null {
  if (!due) return null;
  const left = daysBetween(today, due.slice(0, 10));
  return left < 0 ? 'OVERDUE' : left <= lead ? 'SOON' : null;
}

/** Emails start two weeks before the review date, then come every week, every 3 days in the last week, and weekly again once overdue. */
export function reviewDue(due: string, today: string, lastSent?: string): boolean {
  if (!due) return false;
  const left = daysBetween(today, due.slice(0, 10));
  if (left > RULES.reviewEmailDays) return false;
  return gap(lastSent, today, left > 7 ? 7 : left >= 0 ? 3 : 7);
}

/** One email per person per day, whatever the number of items. */
export function digest(name: string, items: ReminderItem[], link = ''): { subject: string; body: string } {
  const n = items.length;
  const group = (k: ReminderKind, title: string) => {
    const rows = items.filter((i) => i.kind === k);
    return rows.length ? `${title}\n${rows.map((r) => `  - ${r.text}`).join('\n')}\n\n` : '';
  };
  return {
    subject: n === 1 ? `Reminder: ${items[0].text}` : `${n} things are waiting for you`,
    body: `Hello ${name || 'there'},\n\n` +
      group('ACK', 'Policies to read and acknowledge:') +
      group('CLAIM', 'Expense claims waiting for your decision:') +
      group('REVIEW', 'Policies due for review:') +
      `Open the HR portal to take care of these.${link ? `\n${link}` : ''}\n`,
  };
}
