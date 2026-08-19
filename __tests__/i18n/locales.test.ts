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

/**
 * A plural key is a base plus a CLDR category, and which categories exist is a property
 * of the language rather than of the catalogue.
 *
 * English has two, Japanese and Chinese have one, and Arabic has six. Demanding that every
 * file carry exactly English's keys — which is what this test used to do — makes the
 * correct Arabic catalogue fail and the broken one pass: with only `_one` and `_other`,
 * i18next resolves `few` for three files, finds nothing, and falls back to English. An
 * Arabic user converting three files read an English sentence.
 */
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;

const categoriesFor = (code: string): readonly string[] =>
  new Intl.PluralRules(code).resolvedOptions().pluralCategories;

const pluralBase = (key: string): string | null =>
  PLURAL_SUFFIX.test(key) ? key.replace(PLURAL_SUFFIX, '') : null;

/** English's keys, split into the ones that are plural families and the ones that are not. */
const singularKeys = [...english.keys()].filter((key) => pluralBase(key) === null);
const pluralBases = [
  ...new Set([...english.keys()].map(pluralBase).filter((base): base is string => base !== null)),
];

/** Exactly the keys a given language should contain — no more, no fewer. */
function expectedKeys(code: string): Set<string> {
  const expected = new Set(singularKeys);
  for (const base of pluralBases) {
    for (const category of categoriesFor(code)) expected.add(`${base}_${category}`);
  }
  return expected;
}

/** `{{count}}`, `{{name}}` and friends. A translation that drops one renders a hole. */
const placeholders = (value: string): string[] =>
  (value.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((token) => token.replace(/\s/g, '')).sort();

/**
 * What a translated plural form is measured against.
 *
 * English may not have the category — there is no English `_few` — so the comparison
 * falls back to English's `_other`, which is the form that carries the count.
 */
const englishCounterpart = (key: string): string | undefined => {
  const direct = english.get(key);
  if (direct !== undefined) return direct;
  const base = pluralBase(key);
  return base === null ? undefined : english.get(`${base}_other`);
};

describe('every language covers every string', () => {
  it('ships a file for each of the nine', () => {
    expect(Object.keys(locales)).toHaveLength(9);
  });

  it('English itself matches the plural categories English has', () => {
    expect([...english.keys()].sort()).toEqual([...expectedKeys('en')].sort());
  });

  it.each(others)('%s has no missing keys', (code) => {
    const flat = flatten(locales[code]!);
    expect([...expectedKeys(code)].filter((key) => !flat.has(key))).toEqual([]);
  });

  it.each(others)('%s has no keys it should not', (code) => {
    // A stale key is a string nobody can see and nobody will notice is wrong. A plural
    // form the language has no category for is the same thing: `_one` in Japanese can
    // never be selected, so a mistake in it is invisible until somebody reads the file.
    const flat = flatten(locales[code]!);
    const expected = expectedKeys(code);
    expect([...flat.keys()].filter((key) => !expected.has(key))).toEqual([]);
  });

  it.each(others)('%s covers every plural category the language has', (code) => {
    const flat = flatten(locales[code]!);
    const gaps: string[] = [];
    for (const base of pluralBases) {
      for (const category of categoriesFor(code)) {
        if (!flat.has(`${base}_${category}`)) gaps.push(`${base}_${category}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it.each(others)('%s keeps every interpolation English has', (code) => {
    const flat = flatten(locales[code]!);
    const broken = [...flat.entries()]
      .filter(([key, translated]) => {
        const source = englishCounterpart(key);
        return source !== undefined && placeholders(source).join() !== placeholders(translated).join();
      })
      .map(([key]) => key);

    expect(broken).toEqual([]);
  });
});

/**
 * The catalogue is only half the promise; the other half is that i18next actually resolves
 * what the catalogue holds. These assert the resolution, not the file.
 */
describe('plural resolution reaches the translation', () => {
  it.each(others)('%s never falls back to English for a realistic count', (code) => {
    const flat = flatten(locales[code]!);
    const rules = new Intl.PluralRules(code);
    const englishOther = english.get('common.file_other');

    // Counts a batch actually produces. Arabic alone routes these through five different
    // categories, which is the whole reason this test exists.
    const resolved = [0, 1, 2, 3, 5, 11, 42, 100].map((count) =>
      flat.get(`common.file_${rules.select(count)}`),
    );

    expect(resolved.filter((value) => value === undefined)).toEqual([]);
    expect(resolved.filter((value) => value === englishOther)).toEqual([]);
  });
});
