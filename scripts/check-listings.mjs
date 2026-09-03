#!/usr/bin/env node
// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Checks the store listings against the limits the stores enforce.
 *
 * These are the fields where being one character over is not a warning: App Store Connect
 * and Play Console refuse the value, and you find out while pasting it in. Several of the
 * limits are tight enough that a translation cannot help exceeding them, which is exactly
 * why they are worth checking here rather than at submission.
 *
 * Counted in characters, deliberately, because that is how both consoles count. A byte
 * count would let Japanese pass and reject German for the same visible length.
 *
 * Usage: node scripts/check-listings.mjs
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRECTORY = join(ROOT, 'docs/store');

/** The store's own ceilings. */
const LIMITS = {
  appStoreName: 30,
  appStoreSubtitle: 30,
  appStoreKeywords: 100,
  appStorePromo: 170,
  appStoreDescription: 4000,
  playTitle: 30,
  playShortDescription: 80,
  playFullDescription: 4000,
  releaseNotes: 500,
};

/** Every language the app ships, so a listing cannot quietly go missing. */
const LANGUAGES = (await readdir(join(ROOT, 'src/i18n/locales')))
  .filter((entry) => entry.endsWith('.json'))
  .map((entry) => entry.replace(/\.json$/, ''))
  .sort();

const problems = [];

for (const language of LANGUAGES) {
  const path = join(DIRECTORY, `listing-${language}.json`);
  let listing;
  try {
    listing = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    problems.push(`${language}: docs/store/listing-${language}.json is missing or unreadable`);
    continue;
  }

  for (const [field, limit] of Object.entries(LIMITS)) {
    const value = listing[field];
    if (typeof value !== 'string' || value.length === 0) {
      problems.push(`${language}: ${field} is missing`);
      continue;
    }
    // Array.from, not .length: an emoji or a Han character outside the basic plane is one
    // character to a store and two to JavaScript.
    const length = Array.from(value).length;
    if (length > limit) {
      problems.push(`${language}: ${field} is ${length} characters, limit is ${limit}`);
    }
  }

  // The app's own copy dropped the em dash; a listing written in the same voice should not
  // reintroduce it.
  for (const [field, value] of Object.entries(listing)) {
    if (typeof value === 'string' && value.includes('—')) {
      problems.push(`${language}: ${field} contains an em dash`);
    }
  }

  // A listing that names a feature the app does not have is the kind of thing review
  // rejects and users notice. These are the words that would mean the app had changed.
  for (const [field, value] of Object.entries(listing)) {
    if (typeof value !== 'string') continue;
    if (/\b(subscription|subscribe|premium|pro version|in-app purchase)\b/i.test(value)) {
      const negated = /\bno\b[^.]{0,40}\b(subscription|premium)\b/i.test(value);
      if (!negated) problems.push(`${language}: ${field} mentions paid tiers, which the app has none of`);
    }
  }
}

if (problems.length > 0) {
  console.error('Store listing check failed:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Store listing check passed: ${LANGUAGES.length} languages, ` +
    `${Object.keys(LIMITS).length} length-limited fields each.`,
);
