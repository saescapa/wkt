/**
 * Formatting utilities for display output
 */

export type TimeFormat = 'short' | 'long';

/**
 * Format a date as a human-readable relative time string
 *
 * @param date - The date to format
 * @param format - 'short' for "5m ago", 'long' for "5 minutes ago"
 * @returns Formatted string like "just now", "5m ago", "yesterday", "3d ago"
 */
export function formatTimeAgo(date: Date, format: TimeFormat = 'short'): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'just now';
  } else if (diffMins < 60) {
    return format === 'long'
      ? `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`
      : `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return format === 'long'
      ? `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
      : `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return 'yesterday';
  } else {
    return format === 'long'
      ? `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
      : `${diffDays}d ago`;
  }
}
