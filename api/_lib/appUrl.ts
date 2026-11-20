/**
 * The site's public address, from the server settings.
 *
 * The app used two names for the same thing: APP_URL (in .env.example) and APP_BASE_URL (read by tests, offers, screening links,
 * Google Calendar and joiner invites). A server set up from .env.example had one but not the other, so some links worked and
 * others failed. Either name works now. Stray spaces and a trailing slash are removed, and "https://" is added if it was left out.
 * Returns '' when neither is set.
 */
export function configuredSiteUrl(): string {
  const v = (process.env.APP_BASE_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}
