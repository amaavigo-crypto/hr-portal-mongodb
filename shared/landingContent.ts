/**
 * Every piece of text on the public landing site, in one place.
 *
 * - `DEFAULT_TEXT` holds the wording that ships with the app. A platform administrator can override any
 *   entry from the "Landing page" screen; an empty override means "use this default".
 * - `FIELDS` lists the entries in the order the admin screen shows them, grouped by page and section.
 * - `SEO_DEFAULTS` holds the search-engine title, description and share-preview text for each page.
 *
 * Pure TypeScript (no React, no Node imports) so the browser, the server and the admin screen can all use it.
 *
 * Text conventions:
 *   *word*   shows the word in the highlight colour (the coloured words in headlines)
 *   {name}   is replaced by the module name (lower case) where a template mentions it
 *   {year}   is replaced by the current year
 *   {rotor}  in the home headline marks where the rotating word goes
 */

export interface ContentField {
  key: string;
  page: string;
  section: string;
  label: string;
  multiline: boolean;
}

export interface LandingPageDef {
  id: string;
  label: string;
  /** Public path of the page (absent for groups that appear on several pages). */
  path?: string;
  note?: string;
}

export interface SeoFields {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  noindex: boolean;
}

export interface LandingOverrides {
  text: Record<string, string>;
  seo: Record<string, Partial<SeoFields>>;
  updatedAt?: string;
  updatedBy?: string;
}

export const EMPTY_OVERRIDES: LandingOverrides = { text: {}, seo: {} };

export const MODULE_KEYS = ['hiring', 'leave', 'payroll', 'performance', 'people', 'policies', 'tasks'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const SITE_NAME = 'Amaavigo';

// --------------------------------------------------------------------------------------------------------
// Registry
// --------------------------------------------------------------------------------------------------------

export const DEFAULT_TEXT: Record<string, string> = {};
export const FIELDS: ContentField[] = [];

function f(page: string, section: string, key: string, label: string, value: string, multiline?: boolean) {
  if (key in DEFAULT_TEXT) throw new Error(`Duplicate landing content key: ${key}`);
  DEFAULT_TEXT[key] = value;
  FIELDS.push({ key, page, section, label, multiline: multiline ?? value.length > 60 });
}

// --------------------------------------------------------------------------------------------------------
// Site-wide: top strip, menu, footer and the closing call-to-action band
// --------------------------------------------------------------------------------------------------------

// f('site', 'Top strip', 'site.strip.text', 'Announcement text', 'New: Testing CI/CD Pipeline.');
f('site', 'Top strip', 'site.strip.text', 'Announcement text', 'New: hiring automation and the Ask HR assistant are now part of the platform.');
f('site', 'Top strip', 'site.strip.link', 'Announcement link text', 'See what’s new');

f('site', 'Menu', 'site.nav.modules', 'Menu: Modules', 'Modules');
f('site', 'Menu', 'site.nav.smart', 'Menu: Smart features', 'Smart features');
f('site', 'Menu', 'site.nav.security', 'Menu: Security', 'Security');
f('site', 'Menu', 'site.nav.how', 'Menu: How it works', 'How it works');
f('site', 'Menu', 'site.nav.signin', 'Sign in button', 'Sign in');
f('site', 'Menu', 'site.nav.getstarted', 'Get started button', 'Get started');
f('site', 'Menu', 'site.mega.promo.title', 'Modules menu box: heading', 'See how they connect');
f('site', 'Menu', 'site.mega.promo.text', 'Modules menu box: text', 'Seven modules, one record per person.');
f('site', 'Menu', 'site.mega.promo.link', 'Modules menu box: link', 'All modules');

f('site', 'Call-to-action band (bottom of most pages)', 'site.cta.kicker', 'Small label', 'READY WHEN YOU ARE');
f('site', 'Call-to-action band (bottom of most pages)', 'site.cta.title', 'Heading', 'Give your people team a *calmer month.*');
f('site', 'Call-to-action band (bottom of most pages)', 'site.cta.text', 'Text', 'Bring hiring, leave, payroll, performance and policies into one connected workspace.');
f('site', 'Call-to-action band (bottom of most pages)', 'site.cta.primary', 'Main button', 'Get started');
f('site', 'Call-to-action band (bottom of most pages)', 'site.cta.secondary', 'Second button', 'Explore the modules');

f('site', 'Footer', 'site.footer.tagline', 'Tagline under the logo', 'People, processes and progress, moving together.');
f('site', 'Footer', 'site.footer.signin', 'Sign in button', 'Sign in');
f('site', 'Footer', 'site.footer.platform', 'Column heading 1', 'Platform');
f('site', 'Footer', 'site.footer.allmodules', 'Link: all modules', 'All modules');
f('site', 'Footer', 'site.footer.modules', 'Column heading 2', 'Modules');
f('site', 'Footer', 'site.footer.moremodules', 'Column heading 3', 'More modules');
f('site', 'Footer', 'site.footer.copyright', 'Copyright line ({year} = current year)', '© {year} Amaavigo. All rights reserved.');

// --------------------------------------------------------------------------------------------------------
// Home
// --------------------------------------------------------------------------------------------------------

f('home', 'Top banner', 'home.hero.eyebrow', 'Small label', 'THE HR PLATFORM FOR GROWING TEAMS');
f('home', 'Top banner', 'home.hero.title', 'Main heading ({rotor} = the rotating word)', 'All your {rotor} in *one place.*');
f('home', 'Top banner', 'home.hero.rotor', 'Rotating words (comma separated)', 'hiring, leave, payroll, performance, policies');
f('home', 'Top banner', 'home.hero.text', 'Intro paragraph', 'Hire, manage leave, run payroll, review performance and keep policies current without juggling tools. Amaavigo handles the follow-ups so your team can focus on people.');
f('home', 'Top banner', 'home.hero.primary', 'Main button', 'Get started');
f('home', 'Top banner', 'home.hero.secondary', 'Second button', 'Explore the modules');
f('home', 'Top banner', 'home.hero.proof1', 'Tick line 1', 'Seven connected modules');
f('home', 'Top banner', 'home.hero.proof2', 'Tick line 2', 'Roles and permissions per company');
f('home', 'Top banner', 'home.hero.proof3', 'Tick line 3', 'Built for Indian payroll');

const MARQUEE_B = ['Approve a leave request', 'Rank candidates', 'Lock the payroll month', 'Publish a policy', 'Open a review cycle', 'Book an interview', 'Clear an exit', 'Send an offer'];
MARQUEE_B.forEach((t, i) => f('home', 'Scrolling strip (the module names come from each module page)', `home.marquee.${i + 1}`, `Strip item ${i + 1}`, t));

const STATS: [string, string, string][] = [
  ['7', '', 'connected modules'],
  ['35', '+', 'permissions to shape roles'],
  ['6', '', 'ready-made roles'],
  ['10', '', 'attendance reports'],
];
STATS.forEach(([v, s, l], i) => {
  f('home', 'Numbers strip', `home.stats.${i + 1}.value`, `Number ${i + 1}`, v, false);
  f('home', 'Numbers strip', `home.stats.${i + 1}.suffix`, `Number ${i + 1}: after the number (for example +)`, s, false);
  f('home', 'Numbers strip', `home.stats.${i + 1}.label`, `Number ${i + 1}: label`, l, false);
});

f('home', 'Why Amaavigo', 'home.why.kicker', 'Small label', 'WHY AMAAVIGO');
f('home', 'Why Amaavigo', 'home.why.title', 'Heading', 'Less chasing. More *doing.*');
f('home', 'Why Amaavigo', 'home.why.text', 'Text', 'HR work is mostly follow-ups. We built the platform around removing them.');
const WHY: [string, string][] = [
  ['One workspace for HR', 'Hiring, leave, payroll, performance and policies live together, so nobody re-types the same person twice.'],
  ['Automation does the chasing', 'Reminders, approvals, interview links and test marking run on their own. People step in only to decide.'],
  ['Every company kept separate', 'Each company has its own people, roles and data. Add the modules you need and switch off the rest.'],
  ['Made for Indian payroll', 'PF, ESI, professional tax and TDS are built into salary runs, payslips and full-and-final settlements.'],
];
WHY.forEach(([t, x], i) => {
  f('home', 'Why Amaavigo', `home.why.${i + 1}.title`, `Card ${i + 1}: heading`, t);
  f('home', 'Why Amaavigo', `home.why.${i + 1}.text`, `Card ${i + 1}: text`, x);
});

f('home', 'Modules showcase', 'home.modules.kicker', 'Small label', 'THE MODULES');
f('home', 'Modules showcase', 'home.modules.title', 'Heading', 'Start with one. Add the *rest* when you’re ready.');
f('home', 'Modules showcase', 'home.modules.text', 'Text', 'Every module shares the same people, roles and records, so nothing has to be entered twice.');
f('home', 'Modules showcase', 'home.modules.explore', 'Link under each module ({name} = module name)', 'Explore {name}');

f('home', 'Automation (dark band)', 'home.auto.kicker', 'Small label', 'AUTOMATION IN ACTION');
f('home', 'Automation (dark band)', 'home.auto.title', 'Heading', 'The follow-ups happen *on their own.*');
f('home', 'Automation (dark band)', 'home.auto.text', 'Text', 'Take hiring. Once a request is approved, every step after it moves forward without a reminder or a spreadsheet.');
f('home', 'Automation (dark band)', 'home.auto.primary', 'Main button', 'See the smart features');
f('home', 'Automation (dark band)', 'home.auto.secondary', 'Second button', 'Explore hiring');

f('home', 'Smart features teaser', 'home.smart.kicker', 'Small label', 'SMART FEATURES');
f('home', 'Smart features teaser', 'home.smart.title', 'Heading', 'Smart where it helps, *human where it matters.*');
f('home', 'Smart features teaser', 'home.smart.text', 'Text', 'The platform drafts, answers and flags. People review and decide.');
f('home', 'Smart features teaser', 'home.smart.link', 'Link', 'All smart features');

f('home', 'Security teaser', 'home.security.kicker', 'Small label', 'SECURITY AND CONTROL');
f('home', 'Security teaser', 'home.security.title', 'Heading', 'Sensitive people data, *handled carefully.*');
f('home', 'Security teaser', 'home.security.text', 'Text', 'Access is limited by role, each company only sees its own data, files stay private and important actions are recorded.');
f('home', 'Security teaser', 'home.security.link', 'Link', 'How access works');

f('home', 'How it works teaser', 'home.how.kicker', 'Small label', 'HOW IT WORKS');
f('home', 'How it works teaser', 'home.how.title', 'Heading', 'From sign-up to *running smoothly.*');
const HOME_STEPS: [string, string][] = [
  ['Set up your company', 'Sign up, get approved, and add your departments and locations.'],
  ['Add people and roles', 'Invite your team and give each person only the access they need.'],
  ['Switch on what you need', 'Start with one module and add more when ready.'],
  ['Let it run', 'Reminders, approvals and checks work in the background.'],
];
HOME_STEPS.forEach(([t, x], i) => {
  f('home', 'How it works teaser', `home.how.${i + 1}.title`, `Step ${i + 1}: heading`, t);
  f('home', 'How it works teaser', `home.how.${i + 1}.text`, `Step ${i + 1}: text`, x);
});

f('home', 'Questions', 'home.faq.kicker', 'Small label', 'QUESTIONS');
f('home', 'Questions', 'home.faq.title', 'Heading (the questions themselves are under "Questions and answers")', 'Questions teams *ask first.*');

f('home', 'Hero illustration (sample screen)', 'viz.hero.window', 'Window title', 'WORKSPACE OVERVIEW');
f('home', 'Hero illustration (sample screen)', 'viz.window.badge', 'Badge on every sample screen', 'SAMPLE VIEW');
f('home', 'Hero illustration (sample screen)', 'viz.hero.greeting', 'Greeting', 'GOOD MORNING');
f('home', 'Hero illustration (sample screen)', 'viz.hero.heading', 'Heading', 'People operations');
f('home', 'Hero illustration (sample screen)', 'viz.hero.tile1', 'Tile 1 label', 'Open roles');
f('home', 'Hero illustration (sample screen)', 'viz.hero.tile2', 'Tile 2 label', 'Leave pending');
f('home', 'Hero illustration (sample screen)', 'viz.hero.tile3', 'Tile 3 label', 'People');
f('home', 'Hero illustration (sample screen)', 'viz.hero.funnel', 'Funnel heading', 'Hiring funnel');
f('home', 'Hero illustration (sample screen)', 'viz.hero.funnelperiod', 'Funnel period', 'This month');
['Applied', 'Tested', 'Interview', 'Offer'].forEach((t, i) => f('home', 'Hero illustration (sample screen)', `viz.hero.funnel${i + 1}`, `Funnel step ${i + 1}`, t, false));
f('home', 'Hero illustration (sample screen)', 'viz.hero.chipa.title', 'Floating chip 1: heading', 'Ask HR');
f('home', 'Hero illustration (sample screen)', 'viz.hero.chipa.text', 'Floating chip 1: text', '“How many leave days do I have?”');
f('home', 'Hero illustration (sample screen)', 'viz.hero.chipb.title', 'Floating chip 2: heading', 'All approvals up to date');
f('home', 'Hero illustration (sample screen)', 'viz.hero.chipb.text', 'Floating chip 2: text', 'Nothing waiting on you');
const TOASTS: [string, string][] = [
  ['Offer accepted', 'Joining checklist created'],
  ['Leave approved', 'Manager approved 2 days'],
  ['Payslips ready', 'Monthly run is locked'],
  ['Interview booked', 'Meet link sent to 3 people'],
  ['Skills test marked', 'Scored automatically'],
  ['Policy published', '62 of 70 acknowledged'],
];
TOASTS.forEach(([t, s], i) => {
  f('home', 'Hero illustration: pop-up messages', `viz.toast.${i + 1}.title`, `Pop-up ${i + 1}: heading`, t, false);
  f('home', 'Hero illustration: pop-up messages', `viz.toast.${i + 1}.text`, `Pop-up ${i + 1}: text`, s, false);
});

// --------------------------------------------------------------------------------------------------------
// Modules overview page
// --------------------------------------------------------------------------------------------------------

f('modules', 'Top banner', 'modules.hero.kicker', 'Small label', 'THE MODULES');
f('modules', 'Top banner', 'modules.hero.title', 'Main heading', 'Seven modules. *One record* per person.');
f('modules', 'Top banner', 'modules.hero.text', 'Intro paragraph', 'Every module reads from the same people, roles and documents, so a change in one place shows up everywhere it matters.');
f('modules', 'Top banner', 'modules.hero.primary', 'Button', 'Get started');
f('modules', 'Top banner', 'modules.hero.core1', 'Centre of the circle: line 1', 'One record', false);
f('modules', 'Top banner', 'modules.hero.core2', 'Centre of the circle: line 2', 'per person', false);
f('modules', 'Module cards (text comes from each module page)', 'modules.card.link', 'Link on each card', 'Explore', false);
f('modules', 'Works together', 'modules.together.kicker', 'Small label', 'WORKS TOGETHER');
f('modules', 'Works together', 'modules.together.title', 'Heading', 'Change it once. *It updates everywhere.*');
const TOGETHER: [string, string][] = [
  ['Join once', 'A new joiner is added once and appears in leave, payroll, performance and the org chart.'],
  ['Feed each other', 'Attendance and leave feed payroll inputs. Tasks and attendance feed performance evidence.'],
  ['One set of roles', 'Give access once and it applies across modules, so permissions are never out of step.'],
];
TOGETHER.forEach(([t, x], i) => {
  f('modules', 'Works together', `modules.together.${i + 1}.title`, `Card ${i + 1}: heading`, t);
  f('modules', 'Works together', `modules.together.${i + 1}.text`, `Card ${i + 1}: text`, x);
});

// --------------------------------------------------------------------------------------------------------
// One page per module
// --------------------------------------------------------------------------------------------------------

interface ModuleText {
  key: ModuleKey;
  name: string;
  short: string;
  tagline: string;
  headline: string;
  intro: string;
  points: string[];
  highlights: [string, string][];
  steps: [string, string][];
}

const MODULE_TEXT: ModuleText[] = [
  {
    key: 'hiring',
    name: 'Talent acquisition',
    short: 'Requests to joining, on autopilot',
    tagline: 'From the first request to the first day, in one flow you can shape for your own company.',
    headline: 'Hire faster without the follow-up.',
    intro: 'Managers raise a request, the right people approve it, and the platform handles the job post, the ranking, the tests, the interviews and the offer.',
    points: [
      'Hiring requests with budget checks and a final approval',
      'AI-drafted job descriptions, published to your careers page',
      'Candidates ranked against each job, with blind interview scorecards',
      'Interviews with Google Meet links, offers and joining set-up',
    ],
    highlights: [
      ['Requests that approve themselves along the way', 'A manager asks, HR reviews, the founder gives the final nod. Departments stay within their approved headcount and budget.'],
      ['Candidates ranked, not just collected', 'Each applicant is scored against the job from their resume, so the best matches come to the top instead of the latest.'],
      ['Interviews without the back-and-forth', 'Meet links are created for you, invites go out by email, and interviewers submit blind scorecards before seeing each other’s views.'],
      ['Offers that send on approval', 'Once the founder approves, the offer goes to the candidate. Acceptance flows straight into joining and onboarding.'],
    ],
    steps: [
      ['Request', 'A manager raises a hiring request.'],
      ['Approve', 'HR and the founder decide.'],
      ['Post and rank', 'The job goes live and applicants are scored.'],
      ['Interview and offer', 'Tests, interviews and the offer follow your flow.'],
    ],
  },
  {
    key: 'leave',
    name: 'Leave & attendance',
    short: 'Policies, balances and approvals',
    tagline: 'Policies, balances and approvals that follow your own rules.',
    headline: 'Leave and attendance that run to your rules.',
    intro: 'Set your leave year, types and policies once. Balances build up on their own, managers approve from one place, and every change leaves a trace.',
    points: [
      'Leave types, accrual, carry-forward and a year of your choice',
      'Manager approvals with delegation when someone is away',
      'Check-in and check-out, shifts, late marks and corrections',
      'Reports for every view, with CSV export and print',
    ],
    highlights: [
      ['A leave year that fits you', 'Calendar year, financial year or any start month, with locations, weekly offs and holidays set per place.'],
      ['Approvals that never stall', 'Requests go to the manager, then HR if the leave type needs it. When a manager is away, a delegate steps in.'],
      ['Attendance you can trust', 'People can punch in and out through the day. Worked time adds up, late marks follow your shift rules, and missed punches are corrected with approval.'],
      ['Ten ready-made reports', 'Daily detail, absent, late coming, early going, half day, missed punch and more, for one person or a whole team.'],
    ],
    steps: [
      ['Set the rules', 'Leave types, policies, shifts and holidays.'],
      ['Balances build', 'Accrual and carry-forward run daily.'],
      ['Request and approve', 'Employees ask, managers decide.'],
      ['Report', 'Attendance and leave flow into reports and payroll inputs.'],
    ],
  },
  {
    key: 'payroll',
    name: 'Payroll',
    short: 'Salary runs built for India',
    tagline: 'A calm month-end: inputs flow in from attendance, outputs flow out as payslips.',
    headline: 'Payroll that closes without the scramble.',
    intro: 'Attendance and leave feed the month’s inputs. You review the run, approve and lock it, and payslips reach everyone.',
    points: [
      'Salary structures, revisions and arrears',
      'Payroll runs that you review, approve and lock',
      'PF, ESI, professional tax and TDS with declarations',
      'Expense claims, loans and full-and-final settlement',
    ],
    highlights: [
      ['Structures you define', 'Build salary structures with earnings and deductions, revise them later, and let arrears work themselves out.'],
      ['Indian statutory rules built in', 'PF, ESI, professional tax and TDS, with employee declarations and an annual tax statement.'],
      ['Review before you lock', 'See the whole run, compare it with last month, and lock it only when you are happy.'],
      ['Claims, loans and final settlements', 'Employees file expense claims, loans are tracked, and exits produce a full-and-final statement.'],
    ],
    steps: [
      ['Collect inputs', 'Attendance and leave feed in automatically.'],
      ['Run', 'Salaries and deductions are calculated.'],
      ['Review and lock', 'Compare, approve and lock the month.'],
      ['Pay out', 'Payslips are available to every employee.'],
    ],
  },
  {
    key: 'performance',
    name: 'Performance',
    short: 'Goals and reviews on a calendar',
    tagline: 'Reviews that run on a calendar instead of a chase.',
    headline: 'Performance reviews that run themselves.',
    intro: 'Define goals per role once, then let review cycles open on time, gather evidence as work happens, and prompt managers when it is their turn.',
    points: [
      'Goals and measures per role, set up once',
      'Review cycles with self and manager assessments',
      'Evidence collected as work happens',
      'Company-wide views that never expose individual scores',
    ],
    highlights: [
      ['Goals set once, reused', 'Create measures per role and department, and attach them to people automatically.'],
      ['Cycles on a calendar', 'Self and manager assessments open and close on dates you choose, with reminders that do the nagging.'],
      ['Evidence, not memory', 'Work from the Tasks module and attendance feeds into reviews, so conversations start from facts.'],
      ['Views that protect privacy', 'Company-wide dashboards are grouped, never individual. Managers see their own teams.'],
    ],
    steps: [
      ['Set goals', 'Measures per role and department.'],
      ['Open a cycle', 'Self and manager reviews start on schedule.'],
      ['Gather evidence', 'Work and attendance flow in.'],
      ['Review and close', 'Managers finalise and HR signs off.'],
    ],
  },
  {
    key: 'people',
    name: 'People & HR partner',
    short: 'Joining, growing, leaving',
    tagline: 'The whole employee story, from joining to exit.',
    headline: 'The whole employee story in one place.',
    intro: 'Profiles, org charts, onboarding and exits, plus the tools an HR business partner needs to look after teams.',
    points: [
      'Employee directory, profiles, identity and qualifications',
      'Org chart, positions and transfers',
      'Onboarding tasks, exit clearance and letters',
      'Pulse surveys, improvement plans and recognition',
    ],
    highlights: [
      ['A profile for every person', 'Personal details, family, qualifications and identity documents, with sensitive numbers masked until revealed.'],
      ['Org chart that updates itself', 'Reporting lines, positions and span of control follow the people you confirm and the transfers you approve.'],
      ['Joining and leaving, checklisted', 'Onboarding tasks for new joiners, exit clearance for leavers, and letters generated for both.'],
      ['Care for teams', 'Anonymous pulse surveys, improvement plans, recognition and a leadership view for HR partners.'],
    ],
    steps: [
      ['Join', 'Onboarding tasks and documents.'],
      ['Map', 'Place them on the org chart.'],
      ['Grow', 'Surveys, recognition and plans.'],
      ['Exit', 'Clearance, settlement and letters.'],
    ],
  },
  {
    key: 'policies',
    name: 'Policies & documents',
    short: 'Versions, reviews, acknowledgements',
    tagline: 'Every policy has an owner, a version and a record of who has read it.',
    headline: 'Policies everyone has actually read.',
    intro: 'Draft, review and publish with a clear version history. See what changed between versions, and track who has acknowledged each one.',
    points: [
      'Draft, review, approve and publish with version history',
      'See exactly what changed between versions',
      'Acknowledgements tracked per person',
      'An audit trail of every decision',
    ],
    highlights: [
      ['Versions that make sense', 'Every revision is kept. Compare two versions side by side and see exactly what changed.'],
      ['Review before it goes live', 'Creators draft, reviewers approve or ask for changes, and only approved versions are published.'],
      ['Acknowledgements tracked', 'Share a policy with the right people, remind those who have not read it, and see completion at a glance.'],
      ['A trail you can review', 'Key events and decisions are recorded, so you can answer “who approved this and when”.'],
    ],
    steps: [
      ['Draft', 'Write or upload the document.'],
      ['Review', 'Route it to an approver.'],
      ['Publish', 'Share with the intended audience.'],
      ['Track', 'Follow acknowledgements and revisions.'],
    ],
  },
  {
    key: 'tasks',
    name: 'Tasks',
    short: 'Boards, owners and due dates',
    tagline: 'Day-to-day work with boards, owners and due dates.',
    headline: 'Everyday work, organised.',
    intro: 'Projects, boards and a dashboard for the work that happens between the big HR processes, and a source of evidence for reviews.',
    points: [
      'Projects for the whole company or one department',
      'Managers assign work to their own reports',
      'Boards, lists and a dashboard',
      'Attachments on every task',
    ],
    highlights: [
      ['Boards and lists', 'See work as a board or a list, move it along, and keep every task’s history in one place.'],
      ['Assignment that respects structure', 'Managers assign work to their own reports. Projects can be company-wide or just one department.'],
      ['Files on the task', 'Attach documents and images where the work happens, instead of in a separate thread.'],
      ['A dashboard that shows load', 'See what is due, what is late and who is overloaded, without a status meeting.'],
    ],
    steps: [
      ['Create', 'Make a project and add tasks.'],
      ['Assign', 'Managers hand work to their reports.'],
      ['Track', 'Move work across the board.'],
      ['Review', 'Feed results into performance.'],
    ],
  },
];

for (const m of MODULE_TEXT) {
  const p = `mod-${m.key}`;
  const k = `mod.${m.key}`;
  f(p, 'Module name and short lines (also used in the menu, footer and Modules pages)', `${k}.name`, 'Module name', m.name, false);
  f(p, 'Module name and short lines (also used in the menu, footer and Modules pages)', `${k}.short`, 'Short line (menu and related modules)', m.short);
  f(p, 'Module name and short lines (also used in the menu, footer and Modules pages)', `${k}.tagline`, 'Tagline (cards and module box)', m.tagline);
  f(p, 'Top banner', `${k}.headline`, 'Main heading', m.headline);
  f(p, 'Top banner', `${k}.intro`, 'Intro paragraph', m.intro);
  m.points.forEach((t, i) => f(p, 'What’s inside (checklist)', `${k}.point.${i + 1}`, `Point ${i + 1}`, t));
  m.highlights.forEach(([t, x], i) => {
    f(p, 'What you get (4 cards)', `${k}.highlight.${i + 1}.title`, `Card ${i + 1}: heading`, t);
    f(p, 'What you get (4 cards)', `${k}.highlight.${i + 1}.text`, `Card ${i + 1}: text`, x);
  });
  m.steps.forEach(([t, x], i) => {
    f(p, 'How it flows (4 steps)', `${k}.step.${i + 1}.title`, `Step ${i + 1}: heading`, t, false);
    f(p, 'How it flows (4 steps)', `${k}.step.${i + 1}.text`, `Step ${i + 1}: text`, x);
  });
}

// Words on the page template that every module page shares ({name} = the module name in lower case).
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.crumb.home', 'Breadcrumb: Home', 'Home', false);
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.crumb.modules', 'Breadcrumb: Modules', 'Modules', false);
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.hero.primary', 'Top banner: main button', 'Get started', false);
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.hero.secondary', 'Top banner: second button', 'All modules', false);
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.get.kicker', '“What you get”: small label', 'WHAT YOU GET', false);
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.get.title', '“What you get”: heading', 'Built for the way *{name}* really works.');
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.flow.kicker', '“How it flows”: small label', 'HOW IT FLOWS', false);
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.flow.title', '“How it flows”: heading', 'From start to *done.*');
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.inside.kicker', '“What’s inside”: small label', 'WHAT’S INSIDE', false);
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.inside.title', '“What’s inside”: heading', 'Everything {name} needs.');
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.inside.button', '“What’s inside”: box button', 'Open this module', false);
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.with.kicker', '“Works with”: small label', 'WORKS WITH', false);
f('mod-shared', 'Page template shared by all module pages', 'tpl.mod.with.title', '“Works with”: heading', 'Pairs well with *the rest.*');

// --------------------------------------------------------------------------------------------------------
// Smart features
// --------------------------------------------------------------------------------------------------------

f('smart', 'Top banner', 'smart.hero.kicker', 'Small label', 'SMART FEATURES');
f('smart', 'Top banner', 'smart.hero.title', 'Main heading', 'Automation that *earns your trust.*');
f('smart', 'Top banner', 'smart.hero.text', 'Intro paragraph', 'Smart where it helps, human where it matters. The platform does the legwork, and people review and decide.');

f('smart', 'Ask HR', 'smart.ask.kicker', 'Small label', 'ASK HR');
f('smart', 'Ask HR', 'smart.ask.title', 'Heading', 'Answers from your own data and policies.');
f('smart', 'Ask HR', 'smart.ask.text', 'Text', 'Employees ask about leave balance, notice period or payday and get an answer from their own record and the published policies. It starts read-only, so nothing is changed by a question.');
['Answers use only that person’s own data', 'Policy answers come from published versions', 'Every question can be reviewed by HR'].forEach((t, i) => f('smart', 'Ask HR', `smart.ask.point.${i + 1}`, `Tick line ${i + 1}`, t));

f('smart', 'Hiring automation (dark band)', 'smart.hiring.kicker', 'Small label', 'HIRING AUTOMATION');
f('smart', 'Hiring automation (dark band)', 'smart.hiring.title', 'Heading', 'A hiring flow that *moves itself.*');
f('smart', 'Hiring automation (dark band)', 'smart.hiring.text', 'Text', 'Skills tests are written from the job description, sent to candidates and marked automatically. Interviews and offers follow the steps you define.');
const SMART_HIRING: [string, string][] = [
  ['Your own steps', 'Define the order of steps per company, and a separate flow per designation if you need one.'],
  ['Tests that mark themselves', 'Questions are drafted from the job description. You edit them once, and results are recorded as candidates finish.'],
  ['You choose how strict', 'Per step, auto-reject below the pass mark or leave the decision to HR.'],
];
SMART_HIRING.forEach(([t, x], i) => {
  f('smart', 'Hiring automation (dark band)', `smart.hiring.${i + 1}.title`, `Card ${i + 1}: heading`, t);
  f('smart', 'Hiring automation (dark band)', `smart.hiring.${i + 1}.text`, `Card ${i + 1}: text`, x);
});

f('smart', 'Flags', 'smart.flags.kicker', 'Small label', 'FLAGS');
f('smart', 'Flags', 'smart.flags.title', 'Heading', 'Early warnings, reviewed by a person.');
f('smart', 'Flags', 'smart.flags.text', 'Text', 'Unusual payroll inputs, repeated late marks and odd leave patterns are flagged for HR to look at. Flags are prompts for a conversation, never a verdict.');
['Compared against the person’s and team’s own history', 'Reviewed and cleared by HR', 'Nothing is changed or paid automatically'].forEach((t, i) => f('smart', 'Flags', `smart.flags.point.${i + 1}`, `Tick line ${i + 1}`, t));

f('smart', 'Our rules', 'smart.rules.kicker', 'Small label', 'OUR RULES');
f('smart', 'Our rules', 'smart.rules.title', 'Heading', 'People stay *in control.*');
const SMART_RULES: [string, string][] = [
  ['A person decides', 'Drafts, rankings and flags support a decision. They never replace one.'],
  ['Your data stays yours', 'Answers use each company’s own records and policies, kept separate from every other company.'],
  ['Everything is recorded', 'Important actions leave a trail, so you can see what happened and who approved it.'],
];
SMART_RULES.forEach(([t, x], i) => {
  f('smart', 'Our rules', `smart.rules.${i + 1}.title`, `Card ${i + 1}: heading`, t);
  f('smart', 'Our rules', `smart.rules.${i + 1}.text`, `Card ${i + 1}: text`, x);
});

// --------------------------------------------------------------------------------------------------------
// Security
// --------------------------------------------------------------------------------------------------------

f('security', 'Top banner', 'sec.hero.kicker', 'Small label', 'SECURITY AND CONTROL');
f('security', 'Top banner', 'sec.hero.title', 'Main heading', 'Sensitive people data, *handled carefully.*');
f('security', 'Top banner', 'sec.hero.text', 'Intro paragraph', 'HR holds some of the most private information in a company. Access is limited by role, files stay private, and important actions are recorded.');
f('security', 'Separate companies', 'sec.companies.kicker', 'Small label', 'SEPARATE COMPANIES');
f('security', 'Separate companies', 'sec.companies.title', 'Heading', 'Each company sees only its own data.');
f('security', 'Separate companies', 'sec.companies.text', 'Text', 'Every company has its own people, documents and settings. New companies are approved before they can start, and access is checked on the server for every request, not just in the screen.');
f('security', 'Roles and permissions', 'sec.roles.kicker', 'Small label', 'ROLES AND PERMISSIONS');
f('security', 'Roles and permissions', 'sec.roles.title', 'Heading', 'Give people exactly the access they need.');
f('security', 'Roles and permissions', 'sec.roles.text', 'Text', 'Start from ready-made roles or build your own from a checklist of permissions. Nobody can hand out access they do not hold themselves, and payroll access is never part of a default role except the admin’s.');
f('security', 'A record of decisions', 'sec.record.kicker', 'Small label', 'A RECORD OF DECISIONS');
f('security', 'A record of decisions', 'sec.record.title', 'Heading', 'Know who approved what, and when.');
f('security', 'A record of decisions', 'sec.record.text', 'Text', 'Approvals, changes and acknowledgements leave a trail you can review later, so audits start from facts instead of memory.');
f('security', 'More protection', 'sec.more.kicker', 'Small label', 'MORE PROTECTION');
f('security', 'More protection', 'sec.more.title', 'Heading', 'The details *that matter.*');
const SEC_MORE: [string, string][] = [
  ['Private files', 'Identity documents and attachments are stored privately and opened through signed links.'],
  ['Numbers masked', 'Sensitive identity numbers are masked until someone with access chooses to reveal them.'],
  ['Privacy in the middle', 'Birthdays show only day and month, mood shows only as company-wide counts, and survey results stay hidden for very small groups.'],
  ['Checked on every request', 'The server verifies who is asking and what they may do before it returns anything.'],
];
SEC_MORE.forEach(([t, x], i) => {
  f('security', 'More protection', `sec.more.${i + 1}.title`, `Card ${i + 1}: heading`, t);
  f('security', 'More protection', `sec.more.${i + 1}.text`, `Card ${i + 1}: text`, x);
});
f('security', 'Sample illustrations', 'viz.iso.company1', 'Company box 1', 'Company A', false);
f('security', 'Sample illustrations', 'viz.iso.company2', 'Company box 2', 'Company B', false);
f('security', 'Sample illustrations', 'viz.iso.company3', 'Company box 3', 'Company C', false);
f('security', 'Sample illustrations', 'viz.iso.contents', 'Line inside each company box', 'People · Payroll · Documents', false);
f('security', 'Sample illustrations', 'viz.iso.blocked', 'Blocked label', 'other companies', false);
const AUDIT: [string, string][] = [
  ['Version 1.8 submitted for review', 'Hema R · HR'],
  ['Changes requested on section 3', 'Omar K · Reviewer'],
  ['Version 1.8 approved', 'Priya S · Founder'],
  ['Published to 70 people', 'System'],
];
AUDIT.forEach(([t, w], i) => {
  f('security', 'Sample illustrations: audit trail', `viz.audit.${i + 1}.title`, `Event ${i + 1}`, t, false);
  f('security', 'Sample illustrations: audit trail', `viz.audit.${i + 1}.who`, `Event ${i + 1}: who`, w, false);
});
['Company Admin', 'Head HR', 'HR', 'Approver / Founder', 'Department Head', 'Employee'].forEach((t, i) => f('security', 'Sample illustrations: role chips', `viz.role.${i + 1}`, `Role chip ${i + 1}`, t, false));
f('security', 'Sample illustrations: role chips', 'viz.role.own', 'Last chip', '+ your own roles', false);

// --------------------------------------------------------------------------------------------------------
// How it works
// --------------------------------------------------------------------------------------------------------

f('how', 'Top banner', 'how.hero.kicker', 'Small label', 'HOW IT WORKS');
f('how', 'Top banner', 'how.hero.title', 'Main heading', 'From sign-up to *running smoothly.*');
f('how', 'Top banner', 'how.hero.text', 'Intro paragraph', 'Begin small and grow at your own pace. Each step has a clear owner and a clear result.');
f('how', 'Top banner', 'how.hero.primary', 'Button', 'Get started', false);
const HOW_ROWS: { title: string; text: string; items: string[] }[] = [
  { title: 'Set up your company', text: 'Sign up with your work email. A platform administrator approves your company, and you get a company admin account.', items: ['Add departments and locations', 'Choose which modules to switch on', 'Set your leave year and holidays'] },
  { title: 'Add people and roles', text: 'Invite people one by one or import a list. Each person gets a role that decides what they can see and do.', items: ['Start from six ready-made roles', 'Create your own from a permission checklist', 'Set reporting lines and approvers'] },
  { title: 'Switch on what you need', text: 'Begin with a single module and add more as your team is ready. They all use the same people and roles.', items: ['Leave and attendance first, or hiring first', 'Payroll when the attendance data is steady', 'Performance, tasks and policies as you grow'] },
  { title: 'Let it run', text: 'Reminders, accruals, approvals and checks run in the background. You step in only when a decision is needed.', items: ['Daily accrual and reminders', 'Approvals with delegation', 'Flags for HR to review'] },
];
HOW_ROWS.forEach((r, i) => {
  f('how', `Step ${i + 1}`, `how.${i + 1}.title`, 'Heading', r.title, false);
  f('how', `Step ${i + 1}`, `how.${i + 1}.text`, 'Text', r.text);
  r.items.forEach((t, j) => f('how', `Step ${i + 1}`, `how.${i + 1}.item.${j + 1}`, `Tick line ${j + 1}`, t));
});
f('how', 'Questions', 'how.faq.kicker', 'Small label', 'QUESTIONS');
f('how', 'Questions', 'how.faq.title', 'Heading (the questions themselves are under "Questions and answers")', 'Questions teams *ask first.*');

// --------------------------------------------------------------------------------------------------------
// Questions and answers (shown on Home and How it works)
// --------------------------------------------------------------------------------------------------------

const FAQ: [string, string][] = [
  ['Do I have to use every module?', 'No. Switch on only what you need, such as leave first or hiring first, and add the rest later. They share the same people and roles, so nothing has to be entered twice.'],
  ['Who can see salary information?', 'Only people you give payroll access to, and each person sees their own payslips. Payroll permissions are not part of any default role except the company admin, so they are handed out on purpose.'],
  ['Does the AI make decisions about people?', 'No. It drafts, summarises and flags. Candidate ranking, anomaly flags and policy drafts are for a person to review, and nothing is rejected, paid or changed automatically without a human step.'],
  ['Can several companies use it?', 'Yes. Each company has its own people, roles, documents and settings, and only sees its own data. New companies are approved before they can start.'],
  ['Is payroll only for India?', 'The statutory side, with PF, ESI, professional tax and TDS, is built for India. Leave, hiring, performance and the other modules are not tied to a country.'],
];
FAQ.forEach(([q, a], i) => {
  f('faq', `Question ${i + 1}`, `faq.${i + 1}.q`, 'Question', q, false);
  f('faq', `Question ${i + 1}`, `faq.${i + 1}.a`, 'Answer', a);
});
export const FAQ_COUNT = FAQ.length;

// --------------------------------------------------------------------------------------------------------
// Sample screens (the product pictures)
// --------------------------------------------------------------------------------------------------------

const SAMPLE = 'Sample screen';
// Hiring
f('mod-hiring', SAMPLE, 'viz.kanban.window', 'Window title', 'HIRING PIPELINE', false);
['Applied', 'Interview', 'Offer'].forEach((t, i) => f('mod-hiring', SAMPLE, `viz.kanban.col${i + 1}`, `Column ${i + 1}`, t, false));
f('mod-hiring', SAMPLE, 'viz.kanban.meta1', 'Caption 1', 'Ranked against the job description', false);
f('mod-hiring', SAMPLE, 'viz.kanban.meta2', 'Caption 2', 'Meet links created for you', false);
// Leave
f('mod-leave', SAMPLE, 'viz.leave.window', 'Window title', 'LEAVE & ATTENDANCE', false);
f('mod-leave', SAMPLE, 'viz.leave.month', 'Calendar month', 'November', false);
f('mod-leave', SAMPLE, 'viz.leave.calendar', 'Calendar caption', 'Team calendar', false);
f('mod-leave', SAMPLE, 'viz.leave.balances', 'Balances heading', 'Your balances', false);
['Annual leave', 'Sick leave', 'Casual leave'].forEach((t, i) => f('mod-leave', SAMPLE, `viz.leave.type${i + 1}`, `Leave type ${i + 1}`, t, false));
f('mod-leave', SAMPLE, 'viz.leave.waiting', 'Approval line', '2 days · waiting', false);
f('mod-leave', SAMPLE, 'viz.leave.approve', 'Approve button', 'Approve', false);
// Payroll
f('mod-payroll', SAMPLE, 'viz.pay.window', 'Window title', 'PAYROLL RUN', false);
f('mod-payroll', SAMPLE, 'viz.pay.payslip', 'Payslip heading', 'Payslip', false);
f('mod-payroll', SAMPLE, 'viz.pay.sample', 'Payslip tag', 'Sample', false);
['Basic', 'House rent allowance', 'Provident fund', 'Professional tax', 'Income tax (TDS)'].forEach((t, i) => f('mod-payroll', SAMPLE, `viz.pay.row${i + 1}`, `Payslip line ${i + 1}`, t, false));
f('mod-payroll', SAMPLE, 'viz.pay.net', 'Net pay label', 'Net pay', false);
f('mod-payroll', SAMPLE, 'viz.pay.chart', 'Chart heading', 'Payroll cost, last six months', false);
f('mod-payroll', SAMPLE, 'viz.pay.lock', 'Lock line', 'Review, approve, then lock the month', false);
// Performance
f('mod-performance', SAMPLE, 'viz.perf.window', 'Window title', 'REVIEW CYCLE', false);
['Goal progress', 'Evidence logged', 'Reviews on time'].forEach((t, i) => f('mod-performance', SAMPLE, `viz.perf.ring${i + 1}`, `Ring ${i + 1} label`, t, false));
['Self review', 'Manager review', 'HR sign-off'].forEach((t, i) => f('mod-performance', SAMPLE, `viz.perf.step${i + 1}`, `Step ${i + 1}`, t, false));
// People
f('mod-people', SAMPLE, 'viz.org.window', 'Window title', 'ORG CHART', false);
f('mod-people', SAMPLE, 'viz.org.meta1', 'Caption 1', 'Span of control, per manager', false);
f('mod-people', SAMPLE, 'viz.org.meta2', 'Caption 2', '10 shown of 246', false);
// Policies
f('mod-policies', SAMPLE, 'viz.policy.window', 'Window title', 'POLICY VERSIONS', false);
f('mod-policies', SAMPLE, 'viz.policy.name', 'Document name', 'Leave policy', false);
f('mod-policies', SAMPLE, 'viz.policy.ctx1', 'Unchanged line (top)', 'Employees may carry forward unused annual leave to the next year.');
f('mod-policies', SAMPLE, 'viz.policy.del', 'Removed line', '− Carry forward is limited to 5 days.', false);
f('mod-policies', SAMPLE, 'viz.policy.add', 'Added line', '+ Carry forward is limited to 8 days.', false);
f('mod-policies', SAMPLE, 'viz.policy.ctx2', 'Unchanged line (bottom)', 'Leave beyond the limit lapses on the last day of the leave year.');
f('mod-policies', SAMPLE, 'viz.policy.ack', 'Acknowledged label', 'Acknowledged', false);
// Tasks
f('mod-tasks', SAMPLE, 'viz.tasks.window', 'Window title', 'TASK BOARD', false);
['To do', 'In progress', 'Done'].forEach((t, i) => f('mod-tasks', SAMPLE, `viz.tasks.col${i + 1}`, `Column ${i + 1}`, t, false));
['Update onboarding checklist', 'Collect Q3 evidence', 'Draft remote work policy', 'Publish holiday calendar', 'Close October attendance'].forEach((t, i) => f('mod-tasks', SAMPLE, `viz.tasks.card${i + 1}`, `Card ${i + 1}`, t, false));
f('mod-tasks', SAMPLE, 'viz.tasks.due', 'Due label', 'Due Fri', false);
f('mod-tasks', SAMPLE, 'viz.tasks.done', 'Done label', 'Done', false);

// Shared pictures: hiring flow, Ask HR chat and Flags (Home and Smart features)
['Request approved', 'Job posted', 'Applicants ranked', 'Test sent and marked', 'Interview booked', 'Offer sent'].forEach((t, i) => f('shared', 'Hiring flow picture (Home and Smart features)', `viz.flow.${i + 1}`, `Step ${i + 1}`, t, false));
f('shared', 'Ask HR chat picture (Home and Smart features)', 'viz.chat.title', 'Chat heading', 'Ask HR', false);
f('shared', 'Ask HR chat picture (Home and Smart features)', 'viz.chat.sub', 'Chat sub-heading', 'Answers from your own record and policies', false);
const QA: [string, string][] = [
  ['How many leave days do I have left?', 'You have 11 days of annual leave and 6 days of sick leave left this year.'],
  ['What is my notice period?', 'Your notice period is 60 days, as per the employment policy you acknowledged.'],
  ['When is payday this month?', 'Salary is credited on the last working day of the month, which is the 28th.'],
];
QA.forEach(([q, a], i) => {
  f('shared', 'Ask HR chat picture (Home and Smart features)', `viz.chat.${i + 1}.q`, `Question ${i + 1}`, q, false);
  f('shared', 'Ask HR chat picture (Home and Smart features)', `viz.chat.${i + 1}.a`, `Answer ${i + 1}`, a);
});
f('shared', 'Flags picture (Home and Smart features)', 'viz.flags.title', 'Panel heading', 'Flags for HR', false);
f('shared', 'Flags picture (Home and Smart features)', 'viz.flags.sub', 'Panel sub-heading', 'Nothing is decided automatically', false);
const FLAGS: [string, string][] = [
  ['Late marks above usual', '3 people in Support this month'],
  ['Payroll input changed 18%', 'Overtime vs last month, Operations'],
  ['Unusual leave pattern', 'Repeated Monday and Friday leave, 1 person'],
];
FLAGS.forEach(([t, s], i) => {
  f('shared', 'Flags picture (Home and Smart features)', `viz.flags.${i + 1}.title`, `Flag ${i + 1}`, t, false);
  f('shared', 'Flags picture (Home and Smart features)', `viz.flags.${i + 1}.text`, `Flag ${i + 1}: detail`, s, false);
});
f('shared', 'Flags picture (Home and Smart features)', 'viz.flags.review', 'Button before review', 'Review', false);
f('shared', 'Flags picture (Home and Smart features)', 'viz.flags.reviewed', 'Button after review', 'Reviewed', false);

// --------------------------------------------------------------------------------------------------------
// Pages (the list the admin screen shows) and search-engine text
// --------------------------------------------------------------------------------------------------------

const MODULE_NAME = (k: ModuleKey) => MODULE_TEXT.find((m) => m.key === k)!.name;

export const PAGES: LandingPageDef[] = [
  { id: 'site', label: 'Menu, strip, footer, call-to-action', note: 'Menu, top strip, footer and the closing call-to-action band. Shown on every page.' },
  { id: 'home', label: 'Home', path: '/' },
  { id: 'modules', label: 'Modules overview', path: '/modules' },
  ...MODULE_KEYS.map((k) => ({ id: `mod-${k}`, label: `Module: ${MODULE_NAME(k)}`, path: `/modules/${k}` })),
  { id: 'mod-shared', label: 'Module pages: shared headings', note: 'Headings every module page uses; {name} is replaced by the module name.' },
  { id: 'smart', label: 'Smart features', path: '/smart-features' },
  { id: 'security', label: 'Security', path: '/security' },
  { id: 'how', label: 'How it works', path: '/how-it-works' },
  { id: 'faq', label: 'Questions and answers', note: 'Shown on Home and How it works.' },
  { id: 'shared', label: 'Shared pictures', note: 'Pictures that appear on Home and Smart features.' },
];

/** Pages that have their own address and therefore their own search-engine fields. */
export const SEO_PAGES = PAGES.filter((p) => p.path);

export const SEO_DEFAULTS: Record<string, SeoFields> = {
  home: {
    title: 'Amaavigo | HR software for hiring, leave, payroll & policies',
    description: 'One HR platform for hiring, leave and attendance, payroll, performance, tasks and policies. Built for growing teams, with Indian payroll built in.',
    ogTitle: 'Amaavigo: the HR platform for growing teams',
    ogDescription: 'Hire, manage leave, run payroll, review performance and keep policies current in one connected workspace.',
    ogImage: '',
    noindex: false,
  },
  modules: {
    title: 'HR modules | Amaavigo',
    description: 'Seven connected HR modules: talent acquisition, leave and attendance, payroll, performance, people, policies and tasks. One record per person.',
    ogTitle: 'Seven HR modules, one record per person',
    ogDescription: 'Start with one module and add the rest when you are ready. Everything shares the same people, roles and records.',
    ogImage: '',
    noindex: false,
  },
  'mod-hiring': {
    title: 'Talent acquisition and hiring software | Amaavigo',
    description: 'Raise hiring requests, rank candidates against the job, schedule interviews with Meet links and send offers, all in one flow you can shape.',
    ogTitle: 'Hire faster without the follow-up',
    ogDescription: 'Requests, approvals, job posts, ranking, interviews and offers in one connected flow.',
    ogImage: '',
    noindex: false,
  },
  'mod-leave': {
    title: 'Leave and attendance management software | Amaavigo',
    description: 'Set your leave year, types and policies once. Balances build up on their own, managers approve from one place and attendance reports are ready.',
    ogTitle: 'Leave and attendance that run to your rules',
    ogDescription: 'Policies, accruals, approvals, shifts, late marks and ten ready-made attendance reports.',
    ogImage: '',
    noindex: false,
  },
  'mod-payroll': {
    title: 'Payroll software for India with PF, ESI and TDS | Amaavigo',
    description: 'Run payroll with salary structures, PF, ESI, professional tax and TDS. Review the run, lock the month and give everyone their payslips.',
    ogTitle: 'Payroll that closes without the scramble',
    ogDescription: 'Attendance feeds the inputs, you review and lock, payslips reach everyone.',
    ogImage: '',
    noindex: false,
  },
  'mod-performance': {
    title: 'Performance review software | Amaavigo',
    description: 'Define goals per role once, open review cycles on time, gather evidence as work happens and keep company-wide views private.',
    ogTitle: 'Performance reviews that run themselves',
    ogDescription: 'Goals, review cycles and evidence on a calendar instead of a chase.',
    ogImage: '',
    noindex: false,
  },
  'mod-people': {
    title: 'Employee records, org chart and HR partner tools | Amaavigo',
    description: 'Employee profiles, org charts, onboarding, exits and letters, plus pulse surveys, improvement plans and recognition for HR business partners.',
    ogTitle: 'The whole employee story in one place',
    ogDescription: 'From joining to exit: profiles, org chart, onboarding checklists and team care.',
    ogImage: '',
    noindex: false,
  },
  'mod-policies': {
    title: 'HR policy and document management software | Amaavigo',
    description: 'Draft, review and publish policies with version history, see what changed between versions and track who has acknowledged each one.',
    ogTitle: 'Policies everyone has actually read',
    ogDescription: 'Versions, reviews, acknowledgements and an audit trail of every decision.',
    ogImage: '',
    noindex: false,
  },
  'mod-tasks': {
    title: 'Task management for HR and teams | Amaavigo',
    description: 'Projects, boards and a dashboard for day-to-day work, with managers assigning to their own reports and attachments on every task.',
    ogTitle: 'Everyday work, organised',
    ogDescription: 'Boards, owners, due dates and a dashboard that shows load.',
    ogImage: '',
    noindex: false,
  },
  smart: {
    title: 'AI and automation in HR you can trust | Amaavigo',
    description: 'Ask HR answers from your own data, hiring flows move themselves and flags go to a person to review. Nothing is decided automatically.',
    ogTitle: 'Automation that earns your trust',
    ogDescription: 'Smart where it helps, human where it matters.',
    ogImage: '',
    noindex: false,
  },
  security: {
    title: 'HR data security and access control | Amaavigo',
    description: 'Each company sees only its own data. Role-based access, private files, masked identity numbers and an audit trail of important actions.',
    ogTitle: 'Sensitive people data, handled carefully',
    ogDescription: 'Access limited by role, files kept private and important actions recorded.',
    ogImage: '',
    noindex: false,
  },
  'how-it-works': {
    title: 'How Amaavigo works | Get started with HR software',
    description: 'Sign up, add people and roles, switch on the modules you need and let reminders, approvals and checks run in the background.',
    ogTitle: 'From sign-up to running smoothly',
    ogDescription: 'Begin small and grow at your own pace.',
    ogImage: '',
    noindex: false,
  },
};

/** SEO key for a page id (the SEO map is keyed by page id, with 'how' stored as 'how-it-works'). */
export const seoKeyForPage = (pageId: string) => (pageId === 'how' ? 'how-it-works' : pageId);

export function normalizePath(path: string): string {
  const clean = (path || '/').split('?')[0].split('#')[0].replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

/** The SEO key (a key of SEO_DEFAULTS) for a public path, or null if the path is not a landing page. */
export function seoKeyForPath(path: string): string | null {
  const p = normalizePath(path);
  if (p === '/') return 'home';
  if (p === '/modules') return 'modules';
  if (p === '/smart-features') return 'smart';
  if (p === '/security') return 'security';
  if (p === '/how-it-works') return 'how-it-works';
  const m = /^\/modules\/([a-z-]+)$/.exec(p);
  if (m && (MODULE_KEYS as readonly string[]).includes(m[1])) return `mod-${m[1]}`;
  return null;
}

/** Every public landing path, for the sitemap. */
export const LANDING_PATHS: string[] = ['/', '/modules', ...MODULE_KEYS.map((k) => `/modules/${k}`), '/smart-features', '/security', '/how-it-works'];

export function resolveSeo(seoKey: string, overrides: LandingOverrides): SeoFields {
  const base = SEO_DEFAULTS[seoKey] || SEO_DEFAULTS.home;
  const o = overrides.seo?.[seoKey] || {};
  const pick = (k: 'title' | 'description' | 'ogTitle' | 'ogDescription' | 'ogImage') => (typeof o[k] === 'string' && o[k]!.trim() ? o[k]!.trim() : base[k]);
  return {
    title: pick('title'),
    description: pick('description'),
    ogTitle: pick('ogTitle'),
    ogDescription: pick('ogDescription'),
    ogImage: pick('ogImage'),
    noindex: typeof o.noindex === 'boolean' ? o.noindex : base.noindex,
  };
}

// --------------------------------------------------------------------------------------------------------
// Validation (used by the server before saving)
// --------------------------------------------------------------------------------------------------------

export const MAX_TEXT_LENGTH = 2000;

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);

/**
 * Keeps only known keys, trims values, drops entries that equal the default or are empty, and enforces length limits.
 * Returns what to store: only real differences from the defaults.
 */
export function sanitizeOverrides(input: any): LandingOverrides {
  const out: LandingOverrides = { text: {}, seo: {} };
  const text = input && typeof input.text === 'object' && input.text ? input.text : {};
  for (const key of Object.keys(DEFAULT_TEXT)) {
    if (!(key in text)) continue;
    const v = clean(text[key], MAX_TEXT_LENGTH);
    if (v && v !== DEFAULT_TEXT[key]) out.text[key] = v;
  }
  const seo = input && typeof input.seo === 'object' && input.seo ? input.seo : {};
  for (const seoKey of Object.keys(SEO_DEFAULTS)) {
    const o = seo[seoKey];
    if (!o || typeof o !== 'object') continue;
    const base = SEO_DEFAULTS[seoKey];
    const kept: Partial<SeoFields> = {};
    for (const [k, max] of [['title', 200], ['description', 400], ['ogTitle', 200], ['ogDescription', 400], ['ogImage', 500]] as const) {
      const v = clean(o[k], max);
      if (v && v !== base[k]) kept[k] = v;
    }
    if (kept.ogImage && !/^https?:\/\//i.test(kept.ogImage) && !kept.ogImage.startsWith('/')) delete kept.ogImage;
    if (typeof o.noindex === 'boolean' && o.noindex !== base.noindex) kept.noindex = o.noindex;
    if (Object.keys(kept).length) out.seo[seoKey] = kept;
  }
  return out;
}

// --------------------------------------------------------------------------------------------------------
// Reading text
// --------------------------------------------------------------------------------------------------------

export function textFor(key: string, overrides: LandingOverrides | undefined, vars?: Record<string, string>): string {
  const o = overrides?.text?.[key];
  let value = typeof o === 'string' && o.trim() ? o : DEFAULT_TEXT[key] ?? '';
  if (vars) for (const [k, v] of Object.entries(vars)) value = value.split(`{${k}}`).join(v);
  return value;
}

/** Splits `Some *highlighted* words` into plain and highlighted pieces. */
export function splitHighlights(text: string): { text: string; hl: boolean }[] {
  const parts: { text: string; hl: boolean }[] = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), hl: false });
    parts.push({ text: m[1], hl: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hl: false });
  return parts;
}

/** The same text with the highlight marks removed (for titles, descriptions and alt text). */
export const stripHighlights = (text: string) => text.replace(/\*([^*]+)\*/g, '$1');
