#!/usr/bin/env node
// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Fails the build if any advertising, analytics or telemetry package appears anywhere
 * in the dependency tree, including transitively.
 *
 * The App Store privacy label and the Play Data Safety form both declare that this app
 * collects nothing. That claim has to be enforced by something other than good
 * intentions: a single transitive dependency pulling in an analytics SDK would make the
 * filing false without anyone noticing. This is that enforcement.
 *
 * Crash reporting is not an exception — it is handled by Xcode Organizer and Play
 * Console Vitals, which need no SDK, are opted into at the OS level, and send data to
 * Apple and Google rather than to us. See docs/ARCHITECTURE.md §0.3.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Matched against package names, case-insensitively, as whole path segments. */
const DENIED = [
  // Advertising
  'react-native-google-mobile-ads',
  'react-native-admob',
  'expo-ads-admob',
  'react-native-fbads',
  'applovin',
  'react-native-unity-ads',
  'ironsource',
  'vungle',
  // Analytics and product telemetry
  '@segment/analytics',
  'amplitude-js',
  '@amplitude/analytics',
  'mixpanel-browser',
  'react-native-mixpanel',
  'posthog-js',
  'posthog-react-native',
  '@datadog/mobile-react-native',
  'react-native-google-analytics',
  '@react-native-firebase/analytics',
  'expo-analytics',
  'react-native-appsflyer',
  'react-native-adjust',
  'branch-sdk',
  'react-native-branch',
  'logrocket',
  'hotjar',
  // Crash SDKs — replaced by platform-native reporting, see the note above.
  '@sentry/react-native',
  'bugsnag-react-native',
  '@bugsnag/react-native',
  '@react-native-firebase/crashlytics',
  'react-native-exception-handler',
];

/** Reads every package.json under node_modules, following scoped packages one level. */
async function collectInstalledPackages(nodeModules) {
  const found = new Map();

  async function walk(directory, depth) {
    if (depth > 1) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const full = join(directory, entry.name);

      if (entry.name.startsWith('@')) {
        await walk(full, depth);
        continue;
      }
      if (entry.name === '.bin' || entry.name === '.cache') continue;

      try {
        const manifest = JSON.parse(await readFile(join(full, 'package.json'), 'utf8'));
        if (manifest.name) found.set(manifest.name, manifest.version ?? 'unknown');
      } catch {
        // Not a package directory; ignore.
      }

      // Nested node_modules from a version conflict.
      const nested = join(full, 'node_modules');
      if (await exists(nested)) await walk(nested, depth);
    }
  }

  await walk(nodeModules, 0);
  return found;
}

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const installed = await collectInstalledPackages(join(ROOT, 'node_modules'));
const violations = [];

for (const [name, version] of installed) {
  const lower = name.toLowerCase();
  for (const denied of DENIED) {
    if (lower === denied || lower.startsWith(`${denied}/`) || lower.includes(denied)) {
      violations.push(`${name}@${version}  (matched "${denied}")`);
      break;
    }
  }
}

if (violations.length > 0) {
  console.error('Telemetry check FAILED. These packages collect user data:\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    '\nThis app files "No data collected" with both stores, and that filing must stay\n' +
      'true. If one of these arrived transitively, find the parent with:\n' +
      '  npm ls <package-name>\n' +
      'Crash reporting is covered by Xcode Organizer and Play Console Vitals, which\n' +
      'need no SDK. See docs/ARCHITECTURE.md §0.3.',
  );
  process.exit(1);
}

console.log(`Telemetry check passed: ${installed.size} packages scanned, none collect user data.`);
