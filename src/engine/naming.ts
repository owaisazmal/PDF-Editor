// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The reference implementation of batch renaming.
 *
 * `JobSpec.swift` and `JobSpec.kt` each contain a copy, because the rename has to happen
 * where the files are written and no JavaScript is alive during a share-extension
 * conversion. This one exists so the UI can show what the names will actually be before
 * the user commits to a batch of four hundred — and the tests against it pin the
 * behaviour the two native copies have to match.
 */

export type NameToken = {
  token: string;
  label: string;
  /** What it expands to, in the words of someone who has not read the code. */
  detail: string;
};

/**
 * Four tokens, not a syntax.
 *
 * Every one of these answers a question people actually ask of a renamer: keep the name,
 * number them, date them, or say what they are. Anything more expressive would be a
 * language, and a language in a text field is a support burden.
 */
export const NAME_TOKENS: readonly NameToken[] = [
  { token: '{name}', label: 'Name', detail: 'The original name, without its extension' },
  { token: '{index}', label: 'Number', detail: 'Position in the batch, from 001' },
  { token: '{date}', label: 'Date', detail: "Today's date, as 2026-08-18" },
  { token: '{format}', label: 'Format', detail: 'The format being written' },
];

export type NameInputs = {
  sourceName: string;
  /** Zero-based; presented as one-based, because that is what a filename means. */
  index: number;
  format: string;
  /** Injected rather than read, so the same inputs always produce the same name. */
  today: Date;
};

const stem = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
};

/** Fixed locale: a filename is no place for locale-dependent ordering, and this sorts. */
const dateStamp = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

/**
 * Expands a pattern for one file.
 *
 * An empty pattern keeps the source name, which is what "no renaming" means and what the
 * native side already does. The extension is not part of this: it comes from the format
 * being written, and letting a pattern set it would let someone name a JPEG `.png`.
 */
export function expandName(pattern: string, inputs: NameInputs): string {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return stem(inputs.sourceName);

  return trimmed
    .replace(/\{name\}/g, stem(inputs.sourceName))
    .replace(/\{index\}/g, String(inputs.index + 1).padStart(3, '0'))
    .replace(/\{date\}/g, dateStamp(inputs.today))
    .replace(/\{format\}/g, inputs.format);
}

/**
 * True when a pattern would give every file in a batch the same name.
 *
 * Worth catching before the batch runs rather than after: the collision resolver would
 * dutifully produce `report (1)`, `report (2)` and so on, which is not what someone who
 * typed a fixed name was picturing.
 */
export const collides = (pattern: string): boolean => {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return false;
  return !trimmed.includes('{name}') && !trimmed.includes('{index}');
};

/** The first few names a pattern would produce, for the line under the field. */
export function previewNames(
  pattern: string,
  sourceNames: string[],
  format: string,
  today: Date,
  limit = 3,
): string[] {
  return sourceNames
    .slice(0, limit)
    .map((sourceName, index) =>
      `${expandName(pattern, { sourceName, index, format, today })}.${format}`,
    );
}

/**
 * Appends a token to a pattern, with a separator where one is needed.
 *
 * Two tokens tapped in a row would otherwise run together: `{date}{index}` produces
 * "2026-08-18001", which reads as one long number rather than a date and a count. A
 * hyphen between adjacent tokens is what someone means, and typing over it is easy where
 * noticing the run-on is not.
 */
export function appendToken(pattern: string, token: string): string {
  if (pattern.length === 0) return token;
  // Only between two tokens. Text the user typed already ends where they meant it to.
  return pattern.endsWith('}') ? `${pattern}-${token}` : `${pattern}${token}`;
}
