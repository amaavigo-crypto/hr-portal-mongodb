import { BookUser, ClipboardCheck, FileBarChart, LayoutList, UserSearch } from 'lucide-react';
import { createModuleNav, NavItem } from '../moduleNav';

/** One entry per screen under the Employee module. `group` becomes a collapsible dropdown in the sidebar. */
export interface EmployeeEntry { key: string; label: string; hint: string; group: 'Transaction' | 'Reports' }

export const EMPLOYEE_ENTRIES: EmployeeEntry[] = [
  { key: 'master', label: 'Employee Master', hint: 'Basic details, identity, personal, family and qualification in one place', group: 'Transaction' },
  { key: 'all360', label: 'Employee 360', hint: 'All details and documents of every employee (HR and admin)', group: 'Reports' },
  { key: 'weekoff', label: 'Weekoff Holiday Report', hint: 'Employee wise Weekoff Holiday Report', group: 'Reports' },
  { key: 'exitclearance', label: 'Exit Clearance Report', hint: 'Exit Clearance Report', group: 'Reports' },
];

export const EMPLOYEE_SECTIONS = ['overview', ...EMPLOYEE_ENTRIES.map((e) => e.key)];

export const employeeNav = createModuleNav('amaavigo_employee_tab', EMPLOYEE_SECTIONS, 'overview', {
  overview: LayoutList, master: BookUser,
  all360: UserSearch, weekoff: FileBarChart, exitclearance: ClipboardCheck,
});

/** Employee 360 is only for people who may open anyone's profile. */
export const employeeNavItems = (canPick = false): NavItem[] => [
  { key: 'overview', label: 'Overview' },
  ...EMPLOYEE_ENTRIES.filter((e) => canPick || e.key !== 'all360').map((e) => ({ key: e.key, label: e.label, group: e.group })),
];
