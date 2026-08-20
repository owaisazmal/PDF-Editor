// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { activeLocale } from '@/i18n';

/**
 * Number and size formatting for display.
 *
 * Uses `Intl` so digits, grouping and the decimal separator follow the user's locale —
 * a Hindi or Arabic user should not see Western grouping in the one place the app
 * shows off its work. Units stay in the locale's own script via `Intl.NumberFormat`
 * unit formatting where available.
 *
 * Every `locale` argument defaults to the app's active language rather than to
 * `undefined`. Left undefined, `Intl` formats against the *device* locale, which is a
 * different thing the moment someone sets a per-app language — and the result is French
 * copy wrapped around English digit grouping in the same sentence. The parameter stays
 * on each signature so tests can pin a locale without touching global state.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * The `Intl` unit each step corresponds to.
 *
 * Worth the extra lookup: a French reader expects `1,5 Mo` and an Arabic reader
 * `1.5 م.ب`, and both are what `Intl` produces from these names. The ASCII table above
 * stays as the fallback for an engine without unit formatting — a wrong unit *name* is a
 * blemish, a crash on the results screen is not.
 */
const INTL_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/**
 * Rounds before formatting, because not every engine rounds afterwards.
 *
 * Node's ICU honours `maximumFractionDigits` alongside `style: 'unit'`. Hermes on iOS does
 * not: its `Intl` is backed by Foundation, and the option is dropped, so a size asked for
 * to one decimal place came out as `4.433 MB` next to `1.013 MB` next to `2.014 MB`. A
 * column of file sizes that changes width row by row reads as a bug, and this one was
 * invisible on the machine the code was written on.
 *
 * Rounding here makes the request unnecessary: the number handed to the formatter already
 * has no digits to drop, so every engine prints the same thing.
 */
const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Formats a byte count the way a file manager does: 1000-based, one decimal place
 * below 10 of a unit and none above, so sizes stay the same width as they change.
 */
/** Zero, in the locale's own byte unit. Split out only because it runs before the loop. */
function formatZero(locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'byte',
      unitDisplay: 'narrow',
    }).format(0);
  } catch {
    return '0 B';
  }
}

export function formatBytes(bytes: number, locale: string = activeLocale()): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return formatZero(locale);

  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }

  const fractionDigits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  };
  const rounded = roundTo(value, fractionDigits);

  try {
    return new Intl.NumberFormat(locale, {
      ...options,
      style: 'unit',
      unit: INTL_UNITS[unit],
      unitDisplay: 'narrow',
    }).format(rounded);
  } catch {
    // `style: 'unit'` is the newest part of `Intl` and the first thing a trimmed ICU
    // build drops. English units in the right number format beat no number at all.
    return `${new Intl.NumberFormat(locale, options).format(rounded)} ${UNITS[unit]}`;
  }
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
export function formatDimensions(
  width: number,
  height: number,
  locale: string = activeLocale(),
): string {
  const n = new Intl.NumberFormat(locale);
  return `${n.format(width)} × ${n.format(height)}`;
}

/**
 * Milliseconds as a short human duration: `0.4s`, `2.1s`, `1m 05s`.
 *
 * The unit goes through `Intl` too. `s` is not the abbreviation for a second in every
 * language — German writes `Sek.`, Arabic `ث` — and a lone Latin letter after an
 * Arabic-Indic numeral is exactly the kind of detail that makes a translated app feel
 * machine-made.
 */
export function formatDuration(ms: number, locale: string = activeLocale()): string {
  const unit = (
    value: number,
    name: 'second' | 'minute',
    { digits = 0, pad = false }: { digits?: number; pad?: boolean } = {},
  ): string => {
    // Padding is asked of `Intl`, not applied afterwards. Padding the finished string
    // pads the unit suffix too — `5s` is already two characters, so it never padded at
    // all, and `1m 05s` had quietly become `1m 5s`.
    const options: Intl.NumberFormatOptions = {
      maximumFractionDigits: digits,
      ...(pad ? { minimumIntegerDigits: 2 } : {}),
    };
    // Same reason as `formatBytes`: an engine that drops the digit limit turned 311 ms
    // into "0.311 sec" where one decimal was asked for.
    const amount = roundTo(value, digits);
    try {
      return new Intl.NumberFormat(locale, {
        ...options,
        style: 'unit',
        unit: name,
        unitDisplay: 'narrow',
      }).format(amount);
    } catch {
      return `${new Intl.NumberFormat(locale, options).format(amount)}${name === 'second' ? 's' : 'm'}`;
    }
  };

  if (ms < 1000) return unit(ms / 1000, 'second', { digits: 1 });

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return unit(totalSeconds, 'second');

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  // Padded so a column of durations does not jitter as the seconds tick over.
  return `${unit(minutes, 'minute')} ${unit(seconds, 'second', { pad: true })}`;
}

/**
 * How the size changed, in words that stay true at the edges.
 *
 * `percentageSaved` rounds, so a batch that grew by a fraction of a percent produced
 * "Larger by 0%" — a contradiction the user has to reconcile. Below a percent in either
 * direction the honest answer is that nothing meaningful changed, and saying so is
 * shorter than the number would have been.
 */
export type SizeChange = {
  /**
   * A catalogue key rather than a word.
   *
   * This runs in a plain module that three screens call, so it cannot reach `t` from
   * where it sits. Returning finished English would have made these three labels the
   * one part of the results card that no translation could touch.
   */
  labelKey: 'common.aboutTheSame' | 'common.largerBy' | 'common.saved';
  /** Empty when the label says everything, as it does for no change. */
  value: string;
  grew: boolean;
};

export function describeSizeChange(
  beforeBytes: number,
  afterBytes: number,
  locale: string = activeLocale(),
): SizeChange {
  const percent = percentageSaved(beforeBytes, afterBytes);

  if (beforeBytes === 0 || percent === 0) {
    return { labelKey: 'common.aboutTheSame', value: '', grew: false };
  }

  const grew = afterBytes > beforeBytes;
  return {
    labelKey: grew ? 'common.largerBy' : 'common.saved',
    // Through `Intl` so the percent sign lands where the language puts it — before the
    // digits in Turkish, after them here — and so Arabic-Indic digits are an option.
    value: new Intl.NumberFormat(locale, { style: 'percent' }).format(Math.abs(percent) / 100),
    grew,
  };
}

/**
 * A fraction as a percentage.
 *
 * Takes the fraction rather than the whole number, because `Intl` wants it that way and
 * because the alternative — interpolating a number into a key that carries a literal `%` —
 * is how the progress readout came to render a bare `100`. The sign is punctuation, and
 * punctuation belongs to the formatter.
 */
export const formatPercent = (fraction: number, locale: string = activeLocale()): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(fraction);

/** A bare number for display — slider values, page counts, anything not a size. */
export const formatNumber = (value: number, locale: string = activeLocale()): string =>
  new Intl.NumberFormat(locale).format(value);

/** A number with a fixed number of decimals, for the margin readout. */
export const formatDecimal = (
  value: number,
  digits: number,
  locale: string = activeLocale(),
): string =>
  new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

/**
 * A list joined the way the language joins lists.
 *
 * `', '` is English punctuation. Arabic separates with `،`, Japanese and Chinese with
 * `、`, and in a right-to-left line a hardcoded comma-space lands on the wrong side of
 * the item it belongs to. `Intl.ListFormat` knows all of that.
 */
export function formatList(items: string[], locale: string = activeLocale()): string {
  // Guarded rather than assumed: `Intl.ListFormat` is the newest of these APIs and the
  // one most likely to be missing from an older engine. A comma-joined list in the wrong
  // punctuation is a blemish; a crash on the results screen is not.
  if (typeof Intl.ListFormat !== 'function') return items.join(', ');
  return new Intl.ListFormat(locale, { style: 'narrow', type: 'unit' }).format(items);
}
