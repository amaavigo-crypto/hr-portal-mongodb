/** Which interviews Hiring Home shows. Pure, so it can be tested. */
export interface HomeInterview { id: string; startIso: string; status: string; candidateName: string; round: string; iAmOnPanel?: boolean; iSubmitted?: boolean }

const WEEK = 7 * 86_400_000;

export const upcomingInterviews = <T extends HomeInterview>(items: T[], nowMs: number): T[] =>
  items.filter((i) => { const t = Date.parse(i.startIso); return i.status !== 'CANCELLED' && i.status !== 'COMPLETED' && t >= nowMs && t <= nowMs + WEEK; })
    .sort((a, b) => a.startIso.localeCompare(b.startIso));

/** Interviews that have started, where this person is on the panel and has not sent a scorecard. */
export const awaitingMyFeedback = <T extends HomeInterview>(items: T[], nowMs: number): T[] =>
  items.filter((i) => i.status !== 'CANCELLED' && !!i.iAmOnPanel && !i.iSubmitted && Date.parse(i.startIso) <= nowMs);
