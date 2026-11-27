/** Public careers page: limits and wording shared by the server, the screens and the tests. */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const DEFAULT_SOURCE = 'careers-page';
export const RETENTION_CHOICES = [3, 6, 12, 24] as const;

export const consentText = (company: string, months: number) =>
  `I agree that ${company} may use the details and resume I send to consider me for this role and may keep them for up to ${months} months. I can ask ${company} to delete them at any time.`;

export const toSlug = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export const toSourceLabel = (v: unknown) => toSlug(v).slice(0, 30) || DEFAULT_SOURCE;

export const careersPath = (slug: string, jobId?: string, source?: string) =>
  `/?careers=${slug}${jobId ? `&job=${encodeURIComponent(jobId)}` : ''}${source ? `&src=${source}` : ''}`;
