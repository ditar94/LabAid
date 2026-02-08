/**
 * Format a date string or Date to a localized short date (e.g. "1/15/2026").
 * Returns an em-dash "—" for null/undefined values.
 *
 * Replaces 15+ inline `new Date(...).toLocaleDateString()` calls across the app.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "\u2014";
  return new Date(value).toLocaleDateString();
}

/**
 * Format a date string or Date to a localized date+time string (e.g. "1/15/2026, 3:45:00 PM").
 * Returns an em-dash "—" for null/undefined values.
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "\u2014";
  return new Date(value).toLocaleString();
}
