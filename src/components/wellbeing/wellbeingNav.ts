import { createModuleNav, NavItem } from '../moduleNav';

export type WbSection = 'play' | 'progress' | 'overview' | 'roles' | 'people' | 'settings';

const ALL: WbSection[] = ['play', 'progress', 'overview', 'roles', 'people', 'settings'];

/** Sections of the Wellbeing module. Everyone plays; HR sections show only with the matching permission. */
export const wellbeingNav = createModuleNav('amaavigo_wellbeing_tab', ALL, 'play', {});

export const wellbeingNavItems = (a: { view: boolean; viewIndividual: boolean; manage: boolean }): NavItem[] => {
  const items: NavItem[] = [
    { key: 'play', label: 'Play', group: 'For everyone' },
    { key: 'progress', label: 'My progress', group: 'For everyone' },
  ];
  if (a.view) items.push({ key: 'overview', label: 'Team overview', group: 'For HR' });
  if (a.manage) items.push({ key: 'roles', label: 'Role skills', group: 'For HR' });
  if (a.viewIndividual) items.push({ key: 'people', label: 'People', group: 'For HR' });
  if (a.manage) items.push({ key: 'settings', label: 'Settings', group: 'For HR' });
  return items;
};
