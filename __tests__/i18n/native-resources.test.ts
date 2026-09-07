// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The two surfaces that cannot read the catalogue still have to be translated.
 *
 * `plugins/localizations/generate.js` compiles the Android notification resources and the
 * share extension's `.strings` and `.stringsdict` out of the same nine locale files. That
 * generation happens at prebuild, which is a bad place to discover a missing key: the
 * failure is a broken build minutes into a release, or — worse, where the fallback covers
 * it — an English notification on a Japanese phone that nobody notices.
 *
 * These assert the same things here, where a pull request can fail instead.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const generate = require('../../plugins/localizations/generate');

type Catalogue = Record<string, unknown>;

const projectRoot = path.join(__dirname, '..', '..');
const catalogue: Record<string, Catalogue> = generate.readCatalogue(projectRoot);
const languages: string[] = generate.languagesIn(projectRoot);

describe('the strings the platforms read, not the app', () => {
  it('has a locale file for every language the app claims', () => {
    expect(languages).toHaveLength(9);
    expect(languages).toContain('en');
  });

  it.each(languages)('%s carries every Android notification string', (language) => {
    for (const entry of generate.ANDROID_STRINGS) {
      expect(typeof generate.value(catalogue, language, entry.key)).toBe('string');
    }
  });

  it.each(languages)('%s carries every share-extension string', (language) => {
    for (const key of generate.IOS_STRINGS) {
      expect(typeof generate.value(catalogue, language, key)).toBe('string');
    }
  });

  it.each(languages)('%s carries every plural form the share extension needs', (language) => {
    for (const plural of generate.IOS_PLURALS) {
      for (const category of generate.categoriesFor(language)) {
        const form = generate.pluralValue(catalogue, language, plural.key, category);
        expect(typeof form).toBe('string');
        expect(form.length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The one that bites. An unescaped apostrophe in an Android resource is not an error —
   * it truncates the string at the quote, silently, at build time. French and Italian are
   * full of apostrophes.
   */
  it('escapes the characters Android treats as syntax', () => {
    expect(generate.escapeAndroid("L'image")).toBe("L\\'image");
    expect(generate.escapeAndroid('say "hi"')).toBe('say \\"hi\\"');
    expect(generate.escapeAndroid('50% done')).toBe('50%% done');
    expect(generate.escapeAndroid('a & b')).toBe('a &amp; b');
    expect(generate.escapeAndroid('<b>')).toBe('&lt;b&gt;');
  });

  /**
   * Positional, not sequential. The progress notification carries two numbers, and the
   * languages that put the total first would otherwise swap them without complaint.
   */
  it('numbers the notification arguments so a translation can reorder them', () => {
    const entry = generate.ANDROID_STRINGS.find(
      (candidate: { resource: string }) => candidate.resource === 'conversion_notification_progress',
    );
    const rendered = generate.androidValue(catalogue, 'en', entry);
    expect(rendered).toContain('%1$d');
    expect(rendered).toContain('%2$d');
  });

  /** A device set to zh-Hans does not match a `values-zh` folder. */
  it('qualifies Chinese by script', () => {
    expect(generate.androidQualifier('zh')).toBe('values-b+zh+Hans');
    expect(generate.androidQualifier('en')).toBe('values');
    expect(generate.androidQualifier('ar')).toBe('values-ar');
  });

  it('writes resources that parse, for every language', () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-l10n-'));
    try {
      generate.writeAndroidStrings(catalogue, path.join(output, 'android'));
      generate.writeIosStrings(catalogue, path.join(output, 'ios'), 'Converter');

      const files: string[] = [];
      const walk = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const full = path.join(directory, entry.name);
          if (entry.isDirectory()) walk(full);
          else files.push(full);
        }
      };
      walk(output);

      // One `values-xx` set and one `.lproj` set per language, plus the locale config.
      expect(files.length).toBeGreaterThanOrEqual(languages.length * 4);

      for (const file of files.filter((name) => name.endsWith('.xml'))) {
        const body = fs.readFileSync(file, 'utf8');
        // Not a parser — a parser is not available here — but enough to catch the
        // failures this generator can actually produce: an unbalanced tag or a raw
        // ampersand from a translation nobody escaped.
        expect(body).toMatch(/^<\?xml version="1\.0"/);
        expect(body.match(/<string /g)?.length ?? 0).toBe(
          body.match(/<\/string>/g)?.length ?? 0,
        );
        expect(body.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, '')).not.toContain('&');
      }

      for (const file of files.filter((name) => name.endsWith('.stringsdict'))) {
        const body = fs.readFileSync(file, 'utf8');
        expect(body.match(/<dict>/g)?.length).toBe(body.match(/<\/dict>/g)?.length);
        expect(body).toContain('NSStringPluralRuleType');
      }
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  });

  /**
   * A placeholder that reaches a plist is shown to the user verbatim.
   *
   * `{{app}}` is substituted with the product name at prebuild so that renaming the app is
   * one edit in app.json rather than nine careful ones across the locale files — careful
   * because in Portuguese "Converter" is also the ordinary verb, and a find-and-replace
   * would have destroyed eight real translations in that file. If the substitution ever
   * stops happening, the permission dialog reads "{{app}} saves your converted images".
   */
  it('leaves no unsubstituted placeholder in a generated plist string', () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-l10n-app-'));
    try {
      generate.writeIosStrings(catalogue, path.join(output, 'ios'), 'Converter', 'Testname');
      const strings = path.join(output, 'ios', 'ShareExtension', 'fr.lproj', 'InfoPlist.strings');
      const body = fs.readFileSync(strings, 'utf8');
      expect(body).toContain('Testname');
      expect(body).not.toMatch(/\{\{\s*\w+\s*\}\}/);
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  });

  /**
   * Arabic selects `few` for three files. If that form is missing the platform falls back,
   * and the fallback is English — which is the bug this whole catalogue exists to prevent.
   */
  it('gives Arabic all six of its plural categories', () => {
    expect(generate.categoriesFor('ar')).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
    for (const plural of generate.IOS_PLURALS) {
      const forms = generate
        .categoriesFor('ar')
        .map((category: string) => generate.pluralValue(catalogue, 'ar', plural.key, category));
      expect(forms.filter(Boolean)).toHaveLength(6);
    }
  });
});
