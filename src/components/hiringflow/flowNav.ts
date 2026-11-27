import { createModuleNav } from '../moduleNav';

/** Views inside the Hiring > Automation tab. "flow" is the builder, opened from the list of flows. */
export type FlowSection = 'workflows' | 'flow' | 'rules' | 'followups' | 'runs' | 'activity';

export const flowNav = createModuleNav('amaavigo_flow_tab', ['workflows', 'flow', 'rules', 'followups', 'runs', 'activity'], 'workflows', {});
