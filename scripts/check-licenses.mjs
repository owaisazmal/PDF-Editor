#!/usr/bin/env node
// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Fails the build on any dependency whose licence is outside the allowlist, and
 * regenerates LICENSES.md.
 *
 * This project ships to the App Store, where GPL is functionally incompatible with
 * Apple's distribution terms, and is itself released under Apache 2.0. A copyleft
 * dependency arriving transitively would be discovered at review time otherwise —
 * which is far too late.
 *
 * Usage:
 *   node scripts/check-licenses.mjs           check only, fail on a violation
 *   node scripts/check-licenses.mjs --write   also regenerate LICENSES.md
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/**
 * The libraries that reach the binary without going through npm.
 *
 * `npm ls` cannot see these: they arrive through Gradle, and two of the three arrive
 * through each other. Bouncy Castle in particular ships inside every Android build as a
 * transitive dependency of PdfBox-Android, and appeared in no inventory at all until
 * somebody read the pom. A dependency that ships is a dependency that needs a licence,
 * whether or not the tool that checks licences can see it.
 *
 * Curated rather than resolved, because resolving them means running Gradle, and a licence
 * inventory that only exists after a twelve-minute build is one nobody regenerates. The
 * list is short and changes rarely; `plugins/withConverterCoreAndroid.js` is where new ones
 * are added, and this list has to be updated alongside it.
 */
const NATIVE_DEPENDENCIES = [
  {
    name: 'Manrope (font)',
    version: '2018',
    license: 'OFL-1.1',
    repository: 'https://github.com/sharanda/manrope',
    reason:
      'The typeface. Bundled as font files, so its licence has to travel with the binary; ' +
      'the full text is in assets/fonts/OFL.txt.',
  },
  {
    name: 'androidx.exifinterface:exifinterface',
    version: '1.4.1',
    license: 'Apache-2.0',
    repository: 'https://developer.android.com/jetpack/androidx/releases/exifinterface',
    reason: 'Reads and writes the metadata a conversion has to preserve.',
  },
  {
    name: 'com.tom-roush:pdfbox-android',
    version: '2.0.27.0',
    license: 'Apache-2.0',
    repository: 'https://github.com/TomRoush/PdfBox-Android',
    reason: 'Page-level PDF work Android has no platform API for.',
  },
  {
    name: 'org.bouncycastle:bcprov-jdk15to18',
    version: '1.72',
    license: 'MIT',
    repository: 'https://github.com/bcgit/bc-java',
    reason: 'Transitive dependency of PdfBox-Android; decrypts password-protected PDFs.',
  },
  {
    name: 'org.bouncycastle:bcpkix-jdk15to18',
    version: '1.72',
    license: 'MIT',
    repository: 'https://github.com/bcgit/bc-java',
    reason: 'Transitive dependency of PdfBox-Android.',
  },
  {
    name: 'org.bouncycastle:bcutil-jdk15to18',
    version: '1.72',
    license: 'MIT',
    repository: 'https://github.com/bcgit/bc-java',
    reason: 'Transitive dependency of PdfBox-Android.',
  },
];

/**
 * Permitted licences. Decisions D5 added OFL-1.1 for font assets; IJG accompanies
 * libjpeg-turbo's BSD-3 and Zlib grants. Everything else is a standard permissive
 * licence. See docs/DEPENDENCIES.md.
 */
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'Unlicense',
  'Zlib',
  '0BSD',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'OFL-1.1',
  'IJG',
  'WTFPL',
  'Artistic-2.0',
  // Attribution-only, and build-time data rather than shipped code (browserslist's
  // caniuse-lite). Distinct from CC-BY-NC, which stays forbidden below.
  'CC-BY-4.0',
  'CC-BY-3.0',
]);

/** Rejected wherever they appear, even as one half of a dual licence. */
const FORBIDDEN = [
  'AGPL',
  'LGPL',
  'SSPL',
  'CPAL',
  'CC-BY-NC',
  'NON-COMMERCIAL',
  'COMMONS-CLAUSE',
  'GPL', // Checked last: "AGPL" and "LGPL" both contain it.
];

const isForbidden = (term) => {
  const upper = term.toUpperCase();
  return FORBIDDEN.find((marker) => upper.includes(marker)) ?? null;
};

/**
 * Evaluates an SPDX expression such as `(BSD-3-Clause OR GPL-2.0)`.
 *
 * `OR` is a choice the licensor explicitly offers, so one permitted alternative is
 * enough and we take it — that is what dual licensing is for. `AND` is cumulative, so
 * every term has to be permitted. The chosen alternative is reported, because "we rely
 * on the BSD half of node-forge" is exactly the kind of thing that should be written
 * down rather than rediscovered during a store review.
 */
function verdict(expression) {
  const alternatives = expression
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  if (alternatives.length === 0) return { ok: false, reason: 'no licence declared', chosen: '' };

  const rejected = [];

  for (const alternative of alternatives) {
    const terms = alternative
      .split(/\s+AND\s+/i)
      .map((t) => t.trim().replace(/\*$/, ''))
      .filter(Boolean);

    const forbiddenTerm = terms.map(isForbidden).find(Boolean);
    if (forbiddenTerm) {
      rejected.push(`${alternative} (copyleft: ${forbiddenTerm})`);
      continue;
    }

    const unknown = terms.filter((term) => !ALLOWED.has(term));
    if (unknown.length > 0) {
      rejected.push(`${alternative} (not on the allowlist: ${unknown.join(', ')})`);
      continue;
    }

    return { ok: true, reason: '', chosen: alternative };
  }

  return { ok: false, reason: rejected.join('; '), chosen: '' };
}

const { stdout } = await run(
  'npx',
  ['--yes', 'license-checker-rseidelsohn', '--production', '--json', '--start', ROOT],
  { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
);

const report = JSON.parse(stdout);
const rows = [];
const violations = [];

const SELF = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).name;

for (const [nameAndVersion, info] of Object.entries(report)) {
  const at = nameAndVersion.lastIndexOf('@');
  const name = nameAndVersion.slice(0, at);
  const version = nameAndVersion.slice(at + 1);

  // The root package is this project, not a dependency of it. Its licence is the
  // Apache-2.0 text in LICENSE; `license-checker` reports private packages as
  // UNLICENSED regardless.
  if (name === SELF) continue;

  const expression = String(info.licenses ?? 'UNKNOWN');
  const { ok, reason, chosen } = verdict(expression);

  rows.push({
    name,
    version,
    license: expression,
    // Recorded so a dual-licensed package makes plain which half we rely on.
    chosen: chosen !== expression ? chosen : '',
    repository: info.repository ?? '',
  });
  if (!ok) violations.push({ nameAndVersion, expression, reason });
}

rows.sort((a, b) => a.name.localeCompare(b.name));

if (WRITE) {
  const body = rows
    .map(
      (r) =>
        `| \`${r.name}\` | ${r.version} | ${r.license} | ${r.chosen || '—'} | ${r.repository} |`,
    )
    .join('\n');

  await writeFile(
    join(ROOT, 'LICENSES.md'),
    `# Third-party licences

Copyright (c) 2026 Owais Khan
Licensed under the Apache License, Version 2.0

GENERATED FILE — DO NOT EDIT. Regenerate: \`npm run license:report\`.

Every production dependency and its licence. The same data backs the in-app
**Settings › Open Source Licenses** screen, so the two cannot disagree. Attribution
required by Apache 2.0 and the other notice-bearing licences is in \`NOTICE\`.

${rows.length} packages. Where a package is dual-licensed, the **Relied on** column names
the alternative this project takes.

| Package | Version | Declared | Relied on | Repository |
|---|---|---|---|---|
${body}
`,
    'utf8',
  );
  const nativeBody = NATIVE_DEPENDENCIES.map(
    (d) => `| \`${d.name}\` | ${d.version} | ${d.license} | ${d.reason} | ${d.repository} |`,
  ).join('\n');

  await writeFile(
    join(ROOT, 'LICENSES.md'),
    (await readFile(join(ROOT, 'LICENSES.md'), 'utf8')) +
      `
## Native dependencies

These reach the binary through Gradle rather than npm, so \`npm ls\` cannot see them and
the check above does not cover them. Bouncy Castle arrives transitively, inside
PdfBox-Android.

| Library | Version | Licence | Why it is here | Repository |
|---|---|---|---|---|
${nativeBody}

iOS adds none: the engine there uses ImageIO, PDFKit and vImage, which are part of the
operating system rather than libraries this project ships.
`,
    'utf8',
  );

  // One source, two outputs. The screen in the app reads this rather than a second list,
  // so the inventory a user can see and the inventory in the repository cannot disagree.
  await writeFile(
    join(ROOT, 'src/generated/licenses.json'),
    `${JSON.stringify(
      {
        generated: 'npm run license:report',
        packages: rows.map((r) => ({
          name: r.name,
          version: r.version,
          license: r.chosen || r.license,
        })),
        native: NATIVE_DEPENDENCIES.map((d) => ({
          name: d.name,
          version: d.version,
          license: d.license,
        })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    `wrote LICENSES.md and src/generated/licenses.json ` +
      `(${rows.length} packages, ${NATIVE_DEPENDENCIES.length} native)`,
  );
}

if (violations.length > 0) {
  console.error(`Licence check FAILED. ${violations.length} disallowed package(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.nameAndVersion}\n    licence: ${v.expression}\n    reason:  ${v.reason}`);
  }
  console.error(
    '\nThis project is Apache-2.0 and ships to the App Store, where copyleft terms are\n' +
      'functionally incompatible with Apple distribution. Find the parent with:\n' +
      '  npm ls <package-name>\n' +
      'See docs/DEPENDENCIES.md for the permitted list.',
  );
  process.exit(1);
}

console.log(`Licence check passed: ${rows.length} production packages, all permissively licensed.`);
