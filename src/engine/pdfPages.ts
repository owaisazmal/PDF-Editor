// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The reference implementation of page-range expansion.
 *
 * `PdfPageGeometry.swift` and `PdfPageGeometry.kt` each contain a copy, because the
 * export has to work with no JavaScript alive. This one exists for two reasons: the UI
 * needs to tell the user how many pages a range selects *before* they commit to an
 * export, and the tests against this file are what pin down the behaviour the two native
 * copies have to match.
 *
 * The syntax is the one every PDF tool has used for thirty years, and the reason to keep
 * it is that people already know it: `1-3, 7, 9-` is pages one to three, seven, and nine
 * to the end.
 */

/**
 * Expands a range expression into zero-based page indices.
 *
 * Page numbers are one-based and inclusive on the way in, because that is what a page
 * number means to the person typing it. Duplicates collapse and order is preserved as
 * written, so `3,1,3` selects page three then page one.
 *
 * An empty expression means the whole document. An expression that parses to nothing
 * returns nothing — deliberately not the whole document, because exporting 400 pages
 * when someone typed `4OO` with a letter O is the failure worth preventing.
 */
/**
 * Strict where `Number.parseInt` is not.
 *
 * `parseInt('4OO')` is 4, because it stops at the first character it does not
 * understand. Swift's `Int(_:)` and Kotlin's `toIntOrNull` both refuse the same string,
 * so accepting it here would make this reference disagree with the two implementations
 * it exists to describe — the UI would promise one page and the export would produce
 * none.
 */
function strictInt(token: string | undefined): number | null {
  const trimmed = (token ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(value) ? value : null;
}

export function expandPageRanges(expression: string, pageCount: number): number[] {
  const trimmed = expression.trim();
  if (pageCount <= 0) return [];
  if (trimmed.length === 0) return Array.from({ length: pageCount }, (_, index) => index);

  const pages: number[] = [];
  const seen = new Set<number>();

  for (const part of trimmed.split(',')) {
    const piece = part.trim();
    if (piece.length === 0) continue;

    const bounds = piece.split('-');
    let first: number;
    let last: number;

    if (bounds.length === 1) {
      const single = strictInt(bounds[0]);
      if (single === null) continue;
      first = single;
      last = single;
    } else {
      // An open end means "to the end of the document", so `9-` on a 12-page file is the
      // last four pages, and `-4` is the first four. A non-empty end that is not a
      // number is a typo rather than an open end, and drops the whole part.
      const start = strictInt(bounds[0]);
      const end = strictInt(bounds[1]);
      if (start === null && (bounds[0] ?? '').trim().length > 0) continue;
      if (end === null && (bounds[1] ?? '').trim().length > 0) continue;
      first = start ?? 1;
      last = end ?? pageCount;
    }

    // A reversed range is read as the range the user meant rather than rejected: `7-3`
    // is pages three to seven, which is the only thing it could sensibly be.
    const lower = Math.max(1, Math.min(first, last));
    const upper = Math.min(pageCount, Math.max(first, last));
    if (lower > upper) continue;

    for (let page = lower; page <= upper; page += 1) {
      if (seen.has(page - 1)) continue;
      seen.add(page - 1);
      pages.push(page - 1);
    }
  }

  return pages;
}

/**
 * A short human summary of what a range selects, for the line under the input.
 *
 * Says the count rather than echoing the range back, because the count is the thing the
 * user cannot work out at a glance and the thing that catches a typo.
 */
export function describePageSelection(expression: string, pageCount: number): string {
  if (pageCount <= 0) return 'No pages';

  const selected = expandPageRanges(expression, pageCount);
  if (selected.length === 0) return 'That range does not match any pages';
  if (selected.length === pageCount) return `All ${pageCount} pages`;
  return `${selected.length} of ${pageCount} pages`;
}

/**
 * Splits a document into groups of consecutive pages.
 *
 * Used when the user has asked for "every N pages" rather than named ranges, which is
 * how a scan gets broken into single sheets.
 */
export function groupEveryNPages(pageCount: number, everyN: number): number[][] {
  const size = Math.max(1, Math.floor(everyN));
  const groups: number[][] = [];

  for (let start = 0; start < pageCount; start += size) {
    groups.push(
      Array.from({ length: Math.min(size, pageCount - start) }, (_, offset) => start + offset),
    );
  }

  return groups;
}
