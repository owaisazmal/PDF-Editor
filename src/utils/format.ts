// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Number and size formatting for display.
 *
 * Uses `Intl` so digits, grouping and the decimal separator follow the user's locale —
 * a Hindi or Arabic user should not see Western grouping in the one place the app
 * shows off its work. Units stay in the locale's own script via `Intl.NumberFormat`
 * unit formatting where available.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Formats a byte count the way a file manager does: 1000-based, one decimal place
 * below 10 of a unit and none above, so sizes stay the same width as they change.
 */
export function formatBytes(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';

  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }

  const fractionDigits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

  return `${formatted} ${UNITS[unit]}`;
}

/**
 * The percentage saved between two sizes, as a whole number.
 *
 * Returns a negative value when the output grew, which happens legitimately — a
 * photographic PNG is usually larger than the JPEG it came from. Reporting that
 * honestly is better than showing "0% saved" and looking broken.
 */
export function percentageSaved(beforeBytes: number, afterBytes: number): number {
  if (beforeBytes <= 0) return 0;
  return Math.round(((beforeBytes - afterBytes) / beforeBytes) * 100);
}

/** `1920 × 1080`, with the proper multiplication sign rather than a letter x. */
export function formatDimensions(width: number, height: number, locale?: string): string {
  const n = new Intl.NumberFormat(locale);
  return `${n.format(width)} × ${n.format(height)}`;
}

/** Milliseconds as a short human duration: `0.4s`, `2.1s`, `1m 05s`. */
export function formatDuration(ms: number, locale?: string): string {
  if (ms < 1000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ms / 1000)}s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${new Intl.NumberFormat(locale).format(totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${new Intl.NumberFormat(locale).format(minutes)}m ${String(seconds).padStart(2, '0')}s`;
}
