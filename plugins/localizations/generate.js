// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

const fs = require('node:fs');
const path = require('node:path');

/**
 * Compiles the app's catalogue into the resource formats the two JavaScript-free surfaces
 * read: Android string resources for the foreground service, and `.strings` /
 * `.stringsdict` for the iOS share extension.
 *
 * Kept apart from the config plugin that calls it, and importing nothing from Expo, so the
 * escaping and the plural handling can be tested directly. Both are the kind of thing that
 * fails silently — an unescaped apostrophe truncates an Android string at build time
 * without an error, and a missing plural category prints the wrong noun in the right
 * language — so "it built" is not evidence that either is right.
 */

const LOCALES_DIRECTORY = path.join('src', 'i18n', 'locales');

/** English first: it is the default resource set, the one with no qualifier. */
const DEFAULT_LANGUAGE = 'en';

/**
 * The Android notification resources, and the order of their format arguments.
 *
 * Positional (`%1$d`) rather than sequential (`%d`), because word order is exactly what a
 * translation changes: German puts the total before the count, and a sequential specifier
 * would silently swap the two numbers rather than fail.
 */
const ANDROID_STRINGS = [
  { resource: 'conversion_channel_name', key: 'notification.channelName' },
  { resource: 'conversion_channel_description', key: 'notification.channelDescription' },
  { resource: 'conversion_notification_progress', key: 'notification.progress', args: ['done', 'total'], type: 'd' },
  { resource: 'conversion_notification_preparing', key: 'notification.preparing' },
  { resource: 'conversion_notification_cancelling', key: 'notification.cancelling' },
  { resource: 'conversion_notification_cancel', key: 'notification.cancel' },
];

/** The share extension's strings, by catalogue key. Plurals are handled separately. */
const IOS_STRINGS = [
  'share.reading',
  'share.nothingShared',
  'share.unreadable',
  'share.ready',
  'share.saveAsJpg',
  'share.saveAsPng',
  'share.makePdf',
  'share.cancel',
  'share.converting',
  'share.makingPdf',
  'share.pdfFailed',
  'share.nothingConverted',
  'share.photosDenied',
];

/**
 * Plural families the extension needs, as `.stringsdict` entries.
 *
 * `.strings` has no notion of plural, and the ternary this replaces could only ever
 * express two forms. Arabic has six.
 */
const IOS_PLURALS = [
  { key: 'share.title', arg: 'count', type: 'd' },
  { key: 'share.savedToPhotos', arg: 'count', type: 'd' },
  { key: 'share.someUnreadable', arg: 'count', type: 'd' },
];

/**
 * Info.plist values read by the system rather than by our code.
 *
 * `CFBundleDisplayName` is the one people actually see most: it is the label under the
 * icon in the share sheet, and without a localised override it says the English word to
 * everyone. It reuses `home.title` rather than getting a key of its own, because the entry
 * in the share sheet and the verb on the home screen should be the same word — and that
 * word is already translated nine times.
 */
const IOS_INFO_PLIST_STRINGS = [
  { entry: 'NSPhotoLibraryAddUsageDescription', key: 'permissions.photoLibraryAdd' },
  { entry: 'CFBundleDisplayName', key: 'home.title' },
  { entry: 'CFBundleName', key: 'home.title' },
];

function readCatalogue(projectRoot) {
  const directory = path.join(projectRoot, LOCALES_DIRECTORY);
  const catalogue = {};

  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue;
    catalogue[entry.replace(/\.json$/, '')] = JSON.parse(
      fs.readFileSync(path.join(directory, entry), 'utf8'),
    );
  }

  if (!catalogue[DEFAULT_LANGUAGE]) {
    throw new Error(`withLocalizations: ${LOCALES_DIRECTORY}/${DEFAULT_LANGUAGE}.json is missing.`);
  }
  return catalogue;
}

const lookup = (tree, key) =>
  key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), tree);

/**
 * The value for a key, falling back to English.
 *
 * A missing key is a bug the locale test catches, but a prebuild is the wrong place to
 * find out: failing here would mean a broken build for a missing sentence, so this writes
 * the English and lets the test be the thing that complains.
 */
function value(catalogue, language, key) {
  const translated = lookup(catalogue[language], key);
  if (typeof translated === 'string') return translated;
  const fallback = lookup(catalogue[DEFAULT_LANGUAGE], key);
  if (typeof fallback !== 'string') {
    throw new Error(`withLocalizations: ${key} is missing from ${DEFAULT_LANGUAGE}.json.`);
  }
  return fallback;
}

/** The CLDR plural categories a language actually uses, asked of the platform. */
const categoriesFor = (language) =>
  new Intl.PluralRules(language).resolvedOptions().pluralCategories;

/**
 * One plural form, with a fallback that survives a category English does not have.
 *
 * Arabic needs `zero`, `two`, `few` and `many`; English has none of them, so falling
 * straight back to English by key would throw on every Arabic build. The order that
 * actually helps is: the form asked for, then this language's own `other`, then English.
 * That keeps a half-translated catalogue building and leaves the locale test to be the
 * thing that says a form is missing.
 */
function pluralValue(catalogue, language, base, category) {
  const own = lookup(catalogue[language], `${base}_${category}`);
  if (typeof own === 'string') return own;

  const ownOther = lookup(catalogue[language], `${base}_other`);
  if (typeof ownOther === 'string') return ownOther;

  return value(catalogue, DEFAULT_LANGUAGE, `${base}_other`);
}

// ---------------------------------------------------------------------------- Android

/**
 * Android string escaping.
 *
 * The apostrophe is the one that bites: an unescaped `'` in a resource is a silent
 * truncation at build time, not an error, and French and Italian are full of them.
 */
const escapeAndroid = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    // A literal percent would otherwise be read as the start of a format specifier.
    .replace(/%(?![\d]+\$)/g, '%%');

function androidValue(catalogue, language, entry) {
  let text = value(catalogue, language, entry.key);
  for (const [index, arg] of (entry.args ?? []).entries()) {
    text = text.replace(new RegExp(`\\{\\{\\s*${arg}\\s*\\}\\}`, 'g'), `%${index + 1}$${entry.type}`);
  }
  return escapeAndroid(text);
}

function writeAndroidStrings(catalogue, platformRoot) {
  const resourceRoot = path.join(platformRoot, 'app', 'src', 'main', 'res');

  for (const language of Object.keys(catalogue)) {
    // Android's qualifier for Chinese wants the script, and `zh` alone would not match a
    // device set to zh-Hans. `b+zh+Hans` is the modern form that does.
    const qualifier = androidQualifier(language);
    const directory = path.join(resourceRoot, qualifier);
    fs.mkdirSync(directory, { recursive: true });

    const body = ANDROID_STRINGS.map(
      (entry) => `    <string name="${entry.resource}">${androidValue(catalogue, language, entry)}</string>`,
    ).join('\n');

    fs.writeFileSync(
      path.join(directory, 'converter_strings.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<!--\n    GENERATED by plugins/withLocalizations.js from src/i18n/locales/${language}.json — do not edit.\n-->\n<resources>\n${body}\n</resources>\n`,
      'utf8',
    );
  }

  // What the system's per-app language picker offers.
  const xmlDirectory = path.join(resourceRoot, 'xml');
  fs.mkdirSync(xmlDirectory, { recursive: true });
  const locales = Object.keys(catalogue)
    .sort()
    .map((language) => `    <locale android:name="${language === 'zh' ? 'zh-Hans' : language}"/>`)
    .join('\n');
  fs.writeFileSync(
    path.join(xmlDirectory, 'locales_config.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<!--\n    GENERATED by plugins/withLocalizations.js — do not edit.\n-->\n<locale-config xmlns:android="http://schemas.android.com/apk/res/android">\n${locales}\n</locale-config>\n`,
    'utf8',
  );
}

// -------------------------------------------------------------------------------- iOS

/** `.strings` is a C-like format: only the quote and the backslash need escaping. */
const escapeStrings = (text) => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const escapeXml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `{{count}}` becomes `%d`, `{{saved}}` becomes `%@`, in the order they are declared. */
function toFormat(text, args) {
  let formatted = text;
  for (const [index, arg] of args.entries()) {
    formatted = formatted.replace(
      new RegExp(`\\{\\{\\s*${arg.name}\\s*\\}\\}`, 'g'),
      `%${index + 1}$${arg.type}`,
    );
  }
  return formatted;
}

function writeIosStrings(catalogue, platformRoot, appName, productName) {
  const targets = [
    { root: path.join(platformRoot, 'ShareExtension'), strings: true },
    { root: path.join(platformRoot, appName), strings: false },
  ];

  for (const language of Object.keys(catalogue)) {
    for (const target of targets) {
      const directory = path.join(target.root, `${language}.lproj`);
      fs.mkdirSync(directory, { recursive: true });

      // Info.plist values go to both: the app asks for photo-library access, and the
      // extension asks for it again from inside its own bundle.
      const infoPlist = IOS_INFO_PLIST_STRINGS.map((entry) => {
        // `{{app}}` is the product name, which lives in app.json rather than in nine
        // translations — so renaming the app is one edit, not nine.
        const text = value(catalogue, language, entry.key).replace(
          /\{\{\s*app\s*\}\}/g,
          productName ?? appName,
        );
        return `"${entry.entry}" = "${escapeStrings(text)}";`;
      }).join('\n');
      fs.writeFileSync(
        path.join(directory, 'InfoPlist.strings'),
        `/* GENERATED by plugins/withLocalizations.js from src/i18n/locales/${language}.json — do not edit. */\n${infoPlist}\n`,
        'utf8',
      );

      if (!target.strings) continue;

      const body = IOS_STRINGS.map(
        (key) => `"${key}" = "${escapeStrings(value(catalogue, language, key))}";`,
      ).join('\n');
      fs.writeFileSync(
        path.join(directory, 'Localizable.strings'),
        `/* GENERATED by plugins/withLocalizations.js from src/i18n/locales/${language}.json — do not edit. */\n${body}\n`,
        'utf8',
      );

      // Plurals, which `.strings` cannot express at all.
      const categories = categoriesFor(language);
      const entries = IOS_PLURALS.map((plural) => {
        // Exactly one argument per family, deliberately. A `.stringsdict` entry whose
        // plural variable sits beside other positional specifiers has to renumber them,
        // and getting that wrong is silent — the wrong argument prints, in the right
        // language. Where a sentence needed both, the copy was split into two sentences.
        const args = [{ name: plural.arg, type: plural.type }];
        const forms = categories
          .map((category) => {
            const text = pluralValue(catalogue, language, plural.key, category);
            return `            <key>${category}</key>\n            <string>${escapeXml(toFormat(text, args).replace(new RegExp(`%1\\$${plural.type}`, 'g'), '%' + plural.type))}</string>`;
          })
          .join('\n');

        return [
          `    <key>${plural.key}</key>`,
          '    <dict>',
          '        <key>NSStringLocalizedFormatKey</key>',
          `        <string>%#@${plural.arg}@</string>`,
          `        <key>${plural.arg}</key>`,
          '        <dict>',
          '            <key>NSStringFormatSpecTypeKey</key>',
          '            <string>NSStringPluralRuleType</string>',
          '            <key>NSStringFormatValueTypeKey</key>',
          `            <string>${plural.type}</string>`,
          forms,
          '        </dict>',
          '    </dict>',
        ].join('\n');
      }).join('\n');

      fs.writeFileSync(
        path.join(directory, 'Localizable.stringsdict'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<!-- GENERATED by plugins/withLocalizations.js from src/i18n/locales/${language}.json — do not edit. -->\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${entries}\n</dict>\n</plist>\n`,
        'utf8',
      );
    }
  }
}

/**
 * The resource qualifier for a language.
 *
 * Chinese needs the script rather than the bare tag: a device set to `zh-Hans` does not
 * match a `values-zh` folder, and `b+zh+Hans` is the form that does.
 */
function androidQualifier(language) {
  if (language === DEFAULT_LANGUAGE) return 'values';
  return language === 'zh' ? 'values-b+zh+Hans' : `values-${language}`;
}

/** The languages the catalogue ships, by filename. */
function languagesIn(projectRoot) {
  return fs
    .readdirSync(path.join(projectRoot, LOCALES_DIRECTORY))
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.replace(/\.json$/, ''))
    .sort();
}


module.exports = {
  LOCALES_DIRECTORY,
  DEFAULT_LANGUAGE,
  ANDROID_STRINGS,
  IOS_STRINGS,
  IOS_PLURALS,
  IOS_INFO_PLIST_STRINGS,
  readCatalogue,
  languagesIn,
  value,
  pluralValue,
  categoriesFor,
  androidQualifier,
  escapeAndroid,
  androidValue,
  writeAndroidStrings,
  writeIosStrings,
};
