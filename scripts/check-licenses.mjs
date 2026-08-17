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
  console.log(`wrote LICENSES.md (${rows.length} packages)`);
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
