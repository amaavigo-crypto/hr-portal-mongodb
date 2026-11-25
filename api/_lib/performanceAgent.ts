/**
 * Performance tool pack for the Ask HR agent. Registry, rules and summaries: shared/performanceAgentTools.ts.
 *
 * Read only. Every tool calls the same Performance route the screens use (`/api/pm/*`), with the signed-in person's own login,
 * so who-sees-what (an employee's own shared review, a manager's own reports, HR and approvers) is decided by that route.
 * Summaries drop ratings and scores on purpose. There is no tool that submits, approves, publishes or changes anything.
 */
import { give, istDay, route, str, type Run } from './agentKit.js';
import {
  PERFORMANCE_AGENT_TOOLS, canRunPerformance, explainPerformance, mayUsePerformanceTool, summarizeAttention, summarizeCycles, summarizeMine,
  summarizeTeam, summarizeTodo,
} from '../../shared/performanceAgentTools.js';

/** Returns the tool result for a Performance tool, or null when `name` is not one of them. */
export async function runPerformanceAgentTool(r: Run, name: string, args: any): Promise<string | null> {
  const def = PERFORMANCE_AGENT_TOOLS.find((t) => t.name === name);
  if (!def) return null;
  if (!mayUsePerformanceTool(r.ctx, def)) return give(r, name, null, { error: 'Not available for your role.' });
  const show = (label: string, j: any, shaped: any) => (j.error ? give(r, name, null, j) : give(r, name, { kind: 'data', label }, shaped));
  switch (name) {
    case 'get_my_performance_todo': { const j = await route(r, 'pm', 'GET', 'home'); return show('Your Performance to-do', j, summarizeTodo(j)); }
    case 'get_my_performance': { const j = await route(r, 'pm', 'GET', 'my'); return show('Your Performance', j, summarizeMine(j)); }
    case 'explain_performance': return give(r, name, { kind: 'data', label: 'How Performance works' }, explainPerformance(canRunPerformance(r.ctx)));
    case 'get_my_team_performance': { const j = await route(r, 'pm', 'GET', 'team'); return show('Your team in Performance', j, summarizeTeam(j)); }
    case 'get_review_cycles': { const j = await route(r, 'pm', 'GET', 'cycles'); return show('Review cycles', j, summarizeCycles(j)); }
    case 'get_reviews_needing_attention': {
      const cycle = str(args?.cycle, 10);
      const j = await route(r, 'pm', 'GET', 'reviews', undefined, cycle ? { cycle } : {});
      return show('Reviews needing attention', j, summarizeAttention(j, istDay()));
    }
    default: return null;
  }
}
