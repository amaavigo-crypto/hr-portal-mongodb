export interface JdRequest {
  positionTitle: string;
  departmentName: string;
  employmentType?: string;
  location?: string;
  minExperienceYears?: number;
  maxExperienceYears?: number;
  vacancies?: number;
  keySkills?: string;
  justification?: string;
  companyName?: string;
}

export interface JdResult {
  text: string;
  generatedBy: 'AI' | 'TEMPLATE';
  note?: string;
}

import { aiEnabled, aiText } from './ai/index.js';
const REQUEST_TIMEOUT_MS = 45000;

function experienceLine(r: JdRequest): string {
  const min = r.minExperienceYears ?? 0;
  const max = r.maxExperienceYears ?? 0;
  if (min && max && max >= min) return `${min}-${max} years`;
  if (min) return `${min}+ years`;
  return 'Entry level / as per profile';
}

/** Deterministic fallback used when no OpenAI key is configured or the call fails. */
export function buildTemplateJd(r: JdRequest): string {
  const company = r.companyName || 'Amaavigo';
  const skills = (r.keySkills || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const skillLines = skills.length ? skills.map((s) => `- ${s}`).join('\n') : '- (add required skills)';

  return [
    `# ${r.positionTitle}`,
    '',
    `**Company:** ${company}`,
    `**Department:** ${r.departmentName}`,
    `**Employment type:** ${r.employmentType || 'Full-time'}`,
    `**Location:** ${r.location || 'To be confirmed'}`,
    `**Experience:** ${experienceLine(r)}`,
    r.vacancies ? `**Openings:** ${r.vacancies}` : '',
    '',
    '## About the role',
    `${company} is hiring a ${r.positionTitle} for the ${r.departmentName} team. ${r.justification ? r.justification.trim() : 'You will work closely with the team to deliver high-quality outcomes.'}`,
    '',
    '## Key responsibilities',
    '- (add responsibilities)',
    '',
    '## Required skills',
    skillLines,
    '',
    '## Preferred skills',
    '- (add preferred skills)',
    '',
    '## What we offer',
    '- (add benefits)',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
}

const SYSTEM_PROMPT = [
  'You write clear, inclusive, professional job descriptions in plain markdown.',
  'Use exactly these sections in this order: a "# <Title>" heading, a short metadata block, "## About the role", "## Key responsibilities", "## Required skills", "## Preferred skills", "## What we offer".',
  'Use bullet points for the last four sections.',
  'Do not invent salary figures, benefits that are not implied, or company facts.',
  'Do not mention age, gender, or other protected attributes.',
  'Use only the facts provided by the user. Where a detail is missing, keep the wording generic.',
  'Return only the job description markdown, with no preamble or code fences.',
].join('\n');

function buildUserPrompt(r: JdRequest): string {
  return [
    `Company: ${r.companyName || 'Amaavigo'}`,
    `Position: ${r.positionTitle}`,
    `Department: ${r.departmentName}`,
    `Employment type: ${r.employmentType || 'Full-time'}`,
    `Location: ${r.location || 'Not specified'}`,
    `Experience: ${experienceLine(r)}`,
    `Openings: ${r.vacancies ?? 1}`,
    `Key skills requested by the hiring manager: ${r.keySkills || 'Not specified'}`,
    `Business justification: ${r.justification || 'Not specified'}`,
  ].join('\n');
}

export async function generateJobDescription(r: JdRequest, cid = ''): Promise<JdResult> {
  if (!aiEnabled() || !cid) {
    return {
      text: buildTemplateJd(r),
      generatedBy: 'TEMPLATE',
      note: 'OPENAI_API_KEY is not configured, so a structured template was generated instead.',
    };
  }
  const res = await aiText({ cid, feature: 'jd', system: SYSTEM_PROMPT, user: buildUserPrompt(r), maxTokens: 1500, timeoutMs: REQUEST_TIMEOUT_MS, budgetMs: REQUEST_TIMEOUT_MS + 10000 });
  if (res.text) return { text: res.text, generatedBy: 'AI' };
  console.warn('[JD Generator] AI call failed, using template:', res.error);
  return {
    text: buildTemplateJd(r),
    generatedBy: 'TEMPLATE',
    note: `AI generation failed (${res.error || 'unknown error'}); a structured template was generated instead.`,
  };
}
