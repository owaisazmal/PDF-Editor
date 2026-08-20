// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Checks that the generated native projects actually carry the app's languages.
 *
 * Everything here is something that has already gone wrong quietly. The Xcode project can
 * reference nine localisation folders and copy all of them into the wrong bundle; the
 * plugin that writes them can be skipped entirely because a target lookup returned null;
 * the Android resources can be written for one language and not the rest. None of those
 * fail a build. Each produces an app that installs, runs, and speaks English to somebody
 * who set their phone to Japanese.
 *
 * Run after `expo prebuild`. Skips cleanly when a platform has not been generated, so it
 * is safe on a machine that only ever builds one of them.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

/**
 * The iOS project and target are named after the app, so the paths below follow whatever
 * app.json says rather than a literal. Hardcoding the name meant a rename silently pointed
 * this check at a directory that no longer existed — and a check that cannot find its
 * subject passes.
 */
const appName = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo.name;
const locales = fs
  .readdirSync(path.join(root, 'src', 'i18n', 'locales'))
  .filter((entry) => entry.endsWith('.json'))
  .map((entry) => entry.replace(/\.json$/, ''))
  .sort();

const problems = [];
const checked = [];

/** Android: one resource file per language, plus the list the system picker reads. */
function checkAndroid() {
  const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
  if (!fs.existsSync(res)) return;
  checked.push('android');

  for (const language of locales) {
    // Chinese is qualified by script, because a device set to zh-Hans does not match
    // a bare `values-zh`.
    const qualifier =
      language === 'en' ? 'values' : language === 'zh' ? 'values-b+zh+Hans' : `values-${language}`;
    const file = path.join(res, qualifier, 'converter_strings.xml');
    if (!fs.existsSync(file)) {
      problems.push(`android: ${qualifier}/converter_strings.xml is missing`);
      continue;
    }
    const body = fs.readFileSync(file, 'utf8');
    if (!body.includes('conversion_notification_progress')) {
      problems.push(`android: ${qualifier}/converter_strings.xml has no progress string`);
    }
    // An unescaped apostrophe truncates the string silently at build time.
    for (const value of body.matchAll(/<string name="[^"]+">([\s\S]*?)<\/string>/g)) {
      if (/(^|[^\\])'/.test(value[1])) {
        problems.push(`android: ${qualifier} has an unescaped apostrophe: ${value[1].slice(0, 40)}`);
      }
    }
  }

  const config = path.join(res, 'xml', 'locales_config.xml');
  if (!fs.existsSync(config)) {
    problems.push('android: res/xml/locales_config.xml is missing, so the system language picker will not list this app');
  }

  const manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(manifest) && !fs.readFileSync(manifest, 'utf8').includes('android:localeConfig')) {
    problems.push('android: the manifest does not declare android:localeConfig');
  }
}

/**
 * iOS: every target that ships strings must reference every `.lproj`, in its OWN resources
 * phase.
 *
 * The phase matters as much as the count. `addResourceFile` silently falls back to the
 * first `Resources` phase in the file when it cannot resolve the target it was given, so
 * the extension's nine folders were all being copied into the app — a project that looked
 * right, built clean, and shipped an extension with no translations in it.
 */
function checkIos() {
  const projectFile = path.join(root, 'ios', `${appName}.xcodeproj`, 'project.pbxproj');
  if (!fs.existsSync(projectFile)) return;
  checked.push('ios');

  const body = fs.readFileSync(projectFile, 'utf8');
  const phases = [...body.matchAll(/\/\* Resources \*\/ = \{([\s\S]*?)\};/g)].map((match) =>
    [...match[1].matchAll(/\/\* ([\w-]+\.lproj) in Resources \*\//g)].map((entry) => entry[1]),
  );

  const withLocalizations = phases.filter((phase) => phase.length > 0);
  if (withLocalizations.length < 2) {
    problems.push(
      `ios: expected the app and the share extension to each reference their own localisations, ` +
        `found ${withLocalizations.length} resources phase(s) carrying any`,
    );
  }

  for (const phase of withLocalizations) {
    const missing = locales.filter((language) => !phase.includes(`${language}.lproj`));
    if (missing.length > 0) {
      problems.push(`ios: a resources phase is missing ${missing.map((l) => `${l}.lproj`).join(', ')}`);
    }
    const duplicates = phase.filter((entry, index) => phase.indexOf(entry) !== index);
    if (duplicates.length > 0) {
      problems.push(`ios: a resources phase copies ${[...new Set(duplicates)].join(', ')} more than once`);
    }
  }

  for (const directory of [appName, 'ShareExtension']) {
    for (const language of locales) {
      const lproj = path.join(root, 'ios', directory, `${language}.lproj`);
      if (!fs.existsSync(lproj)) {
        problems.push(`ios: ${directory}/${language}.lproj was never written`);
      }
    }
  }

  const plist = path.join(root, 'ios', appName, 'Info.plist');
  if (fs.existsSync(plist) && !fs.readFileSync(plist, 'utf8').includes('CFBundleLocalizations')) {
    problems.push('ios: Info.plist does not declare CFBundleLocalizations, so the system language picker will not list this app');
  }
}

/**
 * The app's identity, as it actually landed in each platform project.
 *
 * Added because a rename is the one change that can leave every other check green while
 * the app is half-renamed: the gates read generated paths, and a path that no longer
 * exists makes a check skip rather than fail. Nothing in CI asserted the applicationId,
 * the namespace or the bundle identifier at all until this.
 */
function checkIdentity() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;

  const gradle = path.join(root, 'android', 'app', 'build.gradle');
  if (fs.existsSync(gradle)) {
    const body = fs.readFileSync(gradle, 'utf8');
    for (const field of ['namespace', 'applicationId']) {
      const found = new RegExp(`${field}\\s+['"]([^'"]+)['"]`).exec(body)?.[1];
      if (found !== config.android.package) {
        problems.push(`android: ${field} is ${found}, expected ${config.android.package}`);
      }
    }
  }

  const plist = path.join(root, 'ios', appName, 'Info.plist');
  if (fs.existsSync(plist)) {
    const body = fs.readFileSync(plist, 'utf8');
    // The template leaves this as $(PRODUCT_BUNDLE_IDENTIFIER); the real value is in the
    // build settings, so the project file is where it has to be read from.
    const project = fs.readFileSync(
      path.join(root, 'ios', `${appName}.xcodeproj`, 'project.pbxproj'),
      'utf8',
    );
    if (!project.includes(config.ios.bundleIdentifier)) {
      problems.push(`ios: no build setting carries ${config.ios.bundleIdentifier}`);
    }
    // The extension's id is derived, and a non-clean prebuild can leave it stale.
    if (!project.includes(`${config.ios.bundleIdentifier}.ShareExtension`)) {
      problems.push(
        `ios: the share extension is not ${config.ios.bundleIdentifier}.ShareExtension — ` +
          'a prebuild without --clean leaves the old identifier in place',
      );
    }
    if (!body.includes('CFBundleDisplayName') && !body.includes('CFBundleName')) {
      problems.push('ios: Info.plist declares neither CFBundleName nor CFBundleDisplayName');
    }
  }

  // A rename leaves the previous platform directories behind, and they build.
  for (const stale of fs.existsSync(path.join(root, 'ios')) ? fs.readdirSync(path.join(root, 'ios')) : []) {
    if (stale.endsWith('.xcodeproj') && stale !== `${appName}.xcodeproj`) {
      problems.push(`ios: ${stale} is left over from a previous name — run a --clean prebuild`);
    }
  }
}

checkAndroid();
checkIos();
checkIdentity();

// CI passes this so a platform that failed to generate cannot pass as "skipped".
if (process.argv.includes('--require-both') && checked.length < 2) {
  console.error(
    `Localisation check: expected both platforms, only generated ${checked.join(', ') || 'none'}. ` +
      'Run `npx expo prebuild` for both before this gate.',
  );
  process.exit(1);
}

if (checked.length === 0) {
  console.log('Localisation check skipped: run `npx expo prebuild` first.');
  process.exit(0);
}

if (problems.length > 0) {
  console.error(`Localisation check failed (${checked.join(', ')}):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Localisation check passed: ${locales.length} languages present in ${checked.join(' and ')}.`,
);
