/**
 * Time utility functions for PR age calculations and formatting.
 */

export function hoursAgo(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));
}

export function formatDuration(hours: number): string {
  if (hours < 1) return 'less than 1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours === 0) return `${days}d`;
  return `${days}d ${remainingHours}h`;
}

export function isStale(openedAt: Date, thresholdHours: number): boolean {
  return hoursAgo(openedAt) >= thresholdHours;
}
