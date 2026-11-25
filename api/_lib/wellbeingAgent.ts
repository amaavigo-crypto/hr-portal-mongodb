/**
 * Wellbeing tool pack for the Ask HR agent. Registry, wording and rules: shared/wellbeingAgentTools.ts.
 *
 * Read only. Every tool calls the same Wellbeing route the screens use (`/api/leave/wellbeing-*`), with the signed-in person's
 * own login, so company and permission checks (and the minimum group size) are the ones that already apply. There is no tool for
 * one person's results, and none that changes consent, deletes data or changes settings.
 */
import { give, route, type Run } from './agentKit.js';
import {
  WELLBEING_AGENT_TOOLS, canViewWellbeing, explainWellbeing, mayUseWellbeingTool, summarizeMe, summarizeOverview,
} from '../../shared/wellbeingAgentTools.js';

/** Returns the tool result for a Wellbeing tool, or null when `name` is not one of them. */
export async function runWellbeingAgentTool(r: Run, name: string, _args: any): Promise<string | null> {
  const def = WELLBEING_AGENT_TOOLS.find((t) => t.name === name);
  if (!def) return null;
  if (!mayUseWellbeingTool(r.ctx, def)) return give(r, name, null, { error: 'Not available for your role.' });
  switch (name) {
    case 'get_my_wellbeing': {
      const [me, progress] = await Promise.all([route(r, 'wellbeing', 'GET', 'me'), route(r, 'wellbeing', 'GET', 'progress')]);
      if (me.error) return give(r, name, null, me);
      return give(r, name, { kind: 'data', label: 'Your Wellbeing games' }, summarizeMe(me, progress.error ? null : progress));
    }
    case 'explain_wellbeing':
      return give(r, name, { kind: 'data', label: 'How Wellbeing works' }, explainWellbeing(canViewWellbeing(r.ctx)));
    case 'get_wellbeing_overview': {
      const j = await route(r, 'wellbeing', 'GET', 'overview');
      if (j.error) return give(r, name, null, j);
      return give(r, name, { kind: 'data', label: 'Wellbeing overview' }, summarizeOverview(j));
    }
    default: return null;
  }
}
