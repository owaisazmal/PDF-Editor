// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Nine languages drift the moment English gains a string and nobody says so.
 *
 * i18next falls back to English for a missing key, which is right at runtime and wrong to
 * rely on: a screen half in Spanish and half in English reads as a broken app rather than
 * an untranslated one. This test says so at build time instead.
 */

// Named rather than imported as `it`, `de` and so on: a locale called `it` shadows
// Jest's own `it` and the suite fails to run before a single assertion.
import arabic from '@/i18n/locales/ar.json';
import german from '@/i18n/locales/de.json';
import english_ from '@/i18n/locales/en.json';
import spanish from '@/i18n/locales/es.json';
import french from '@/i18n/locales/fr.json';
import italian from '@/i18n/locales/it.json';
import japanese from '@/i18n/locales/ja.json';
import portuguese from '@/i18n/locales/pt.json';
import chinese from '@/i18n/locales/zh.json';

type Tree = { [key: string]: string | Tree };

const locales: Record<string, Tree> = {
  en: english_,
  es: spanish,
  pt: portuguese,
  de: german,
  fr: french,
  it: italian,
  ja: japanese,
  zh: chinese,
  ar: arabic,
};
const others = Object.keys(locales).filter((code) => code !== 'en');

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = `${prefix}${key}`;
    if (typeof value === 'string') flat.set(path, value);
    else for (const [k, v] of flatten(value, `${path}.`)) flat.set(k, v);
  }
  return flat;
}

const english = flatten(english_ as Tree);

/** `{{count}}`, `{{name}}` and friends. A translation that drops one renders a hole. */
const placeholders = (value: string): string[] =>
  (value.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((token) => token.replace(/\s/g, '')).sort();

describe('every language covers every string', () => {
  it('ships a file for each of the nine', () => {
    expect(Object.keys(locales)).toHaveLength(9);
  });

  it.each(others)('%s has no missing keys', (code) => {
    const flat = flatten(locales[code]!);
    expect([...english.keys()].filter((key) => !flat.has(key))).toEqual([]);
  });

  it.each(others)('%s has no keys English does not', (code) => {
    // A stale key is a string nobody can see and nobody will notice is wrong.
    const flat = flatten(locales[code]!);
    expect([...flat.keys()].filter((key) => !english.has(key))).toEqual([]);
  });

  it.each(others)('%s keeps every interpolation English has', (code) => {
    const flat = flatten(locales[code]!);
    const broken = [...english.entries()]
      .filter(([key, value]) => {
        const translated = flat.get(key);
        return (
          translated !== undefined &&
          placeholders(value).join() !== placeholders(translated).join()
        );
      })
      .map(([key]) => key);

    expect(broken).toEqual([]);
  });
});
