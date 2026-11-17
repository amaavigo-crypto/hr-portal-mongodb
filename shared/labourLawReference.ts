/**
 * Indian labour-law reference points the policy clash check compares against.
 *
 * This is a short list kept by hand, NOT legal advice and NOT complete. It exists so the AI has a stated source to point at
 * instead of relying on memory. Update it when the law changes and move LAST_REVIEWED forward.
 * The four Labour Codes were brought into force on 21 November 2025 and their Central Rules were notified on 8 May 2026;
 * State rules may differ, so each point says what to confirm.
 */
export const LABOUR_LAW_LAST_REVIEWED = '2026-11-17';
export const LABOUR_LAW_NOTE = 'Advisory only. These are a few well-known reference points, last checked on the date shown. Confirm with your lawyer or the current law before relying on them.';

export interface LawPoint { id: string; topic: string; act: string; point: string }

export const LABOUR_LAW: LawPoint[] = [
  { id: 'L1', topic: 'Gratuity', act: 'Code on Social Security, 2020', point: 'Gratuity is payable after 5 years of continuous service. Fixed-term employees become eligible after 1 year of service under their contract.' },
  { id: 'L2', topic: 'Fixed-term employees', act: 'Industrial Relations Code, 2020 and Code on Social Security, 2020', point: 'Fixed-term employees get the same wages, working hours, allowances and benefits as permanent employees doing similar work, in proportion to their period of service.' },
  { id: 'L3', topic: 'Overtime', act: 'Code on Wages, 2019', point: 'Overtime must be paid at twice the normal rate of wages.' },
  { id: 'L4', topic: 'Working hours', act: 'Occupational Safety, Health and Working Conditions Code, 2020', point: 'Weekly working hours are capped at 48 hours; hours beyond the limit count as overtime.' },
  { id: 'L5', topic: 'Annual paid leave', act: 'Occupational Safety, Health and Working Conditions Code, 2020', point: 'An employee earns paid annual leave after 180 days of work in a year.' },
  { id: 'L6', topic: 'Maternity leave', act: 'Code on Social Security, 2020', point: 'Maternity benefit is 26 weeks of paid leave for the first two children and 12 weeks from the third child.' },
  { id: 'L7', topic: 'Equal pay', act: 'Code on Wages, 2019', point: 'An employer must not discriminate on grounds of gender in wages or conditions of recruitment for the same work or work of similar nature.' },
  { id: 'L8', topic: 'Wage deductions and timely payment', act: 'Code on Wages, 2019', point: 'Wages must be paid on time and only deductions allowed by law may be made from them.' },
  { id: 'L9', topic: 'Appointment letters', act: 'Labour Codes', point: 'Employees must be given an appointment letter stating their designation, wages and social security details.' },
  { id: 'L10', topic: 'Sexual harassment', act: 'Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013', point: 'Every workplace with 10 or more employees must have an Internal Committee to hear complaints of sexual harassment.' },
];
