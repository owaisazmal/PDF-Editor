// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
// The instance and its `use` are imported separately: importing the default and then
// reaching for `.use` trips the lint rule that guards against confusing i18next's default
// export with its identically-named named export.
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import ar from './locales/ar.json';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import ja from './locales/ja.json';
import pt from './locales/pt.json';
import zh from './locales/zh.json';

/**
 * Nine languages, chosen for reach rather than for how easy they are.
 *
 * There is no list of which ones are right-to-left, and there deliberately is not: the app
 * no longer decides direction. Both platforms resolve it from the locale before the process
 * starts, and `applyDirection` below only permits it. A hand-kept list of RTL languages here
 * would look load-bearing while affecting nothing.
 *
 * Eight of them cover the largest App Store and Play markets for a utility of this kind.
 * The ninth is Arabic, and it is here to make right-to-left a real constraint rather than
 * a theoretical one: a layout that has never been run in RTL is a layout that does not
 * work in RTL, and finding that out after release means an emergency build.
 *
 * English is the source of truth. Every other file is a translation of it, and any key
 * missing from a translation falls back to English rather than rendering a key — a
 * sentence in the wrong language is recoverable, `home.title` is not.
 */
export const SUPPORTED_LANGUAGES = {
  en: { label: 'English', endonym: 'English' },
  es: { label: 'Spanish', endonym: 'Español' },
  pt: { label: 'Portuguese', endonym: 'Português' },
  de: { label: 'German', endonym: 'Deutsch' },
  fr: { label: 'French', endonym: 'Français' },
  it: { label: 'Italian', endonym: 'Italiano' },
  ja: { label: 'Japanese', endonym: '日本語' },
  zh: { label: 'Chinese (Simplified)', endonym: '简体中文' },
  ar: { label: 'Arabic', endonym: 'العربية' },
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

export const LANGUAGE_CODES = Object.keys(SUPPORTED_LANGUAGES) as LanguageCode[];

const resources = {
  en: { translation: en },
  es: { translation: es },
  pt: { translation: pt },
  de: { translation: de },
  fr: { translation: fr },
  it: { translation: it },
  ja: { translation: ja },
  zh: { translation: zh },
  ar: { translation: ar },
};

/**
 * The device's preferred language, if it is one this app speaks.
 *
 * Matched on the language subtag alone, so `pt-BR` and `pt-PT` both get Portuguese and
 * `zh-Hans-CN` gets Chinese. Region-specific variants are a refinement worth having only
 * once there is evidence anyone needs them; a Brazilian reading European Portuguese is
 * mildly annoyed, and a Brazilian reading English is lost.
 */
export function deviceLanguage(): LanguageCode {
  for (const locale of getLocales()) {
    const code = locale.languageCode?.toLowerCase();
    if (code && code in SUPPORTED_LANGUAGES) return code as LanguageCode;
  }
  return 'en';
}

/**
 * Permits right-to-left, and then gets out of the way.
 *
 * It is tempting to call `forceRTL` with the direction the chosen language wants. Doing
 * that is wrong here, and wrong in a way that only shows up on a real device: `forceRTL`
 * writes a native preference that is read at process start, so it never affects the launch
 * that calls it — only the next one.
 *
 * Play that through. Someone switches the app from Arabic to English in the system's
 * per-app language setting. The OS kills and relaunches the app, which is the restart the
 * direction change needs. But the relaunch happens BEFORE any JavaScript runs, so this
 * function is called during a process that has already laid itself out right-to-left, sets
 * the preference for a launch that has not happened, and returns. The user gets English
 * text in a mirrored layout — arrows pointing backwards, the grid reversed — until they
 * kill the app and open it a second time. Caught in a screenshot, not in a test.
 *
 * `allowRTL(true)` alone is correct because this app follows the system rather than
 * overriding it. Both platforms resolve the app's locale before the process starts and lay
 * the first frame out accordingly, so direction is already right on the launch that matters
 * — including the very first one after a language change. The catalogue and the layout read
 * the same resolved locale, so they cannot disagree.
 *
 * That resolution is only trustworthy because the app declares its languages: Android reads
 * `res/xml/locales_config.xml` and iOS reads `CFBundleLocalizations`, both written by
 * `plugins/withLocalizations.js`. A device set to Hebrew therefore falls back to English
 * AND to left-to-right, rather than to an English catalogue in a mirrored frame.
 *
 * There is deliberately no in-app language picker. Both platforms carry one already, and
 * theirs relaunches the app; ours could not.
 */
function applyDirection(): void {
  I18nManager.allowRTL(true);
}

/** One instance, created here rather than taken from the module's default export. */
export const i18n = createInstance();

export function initI18n(language: LanguageCode = deviceLanguage()): typeof i18n {
  applyDirection();

  void i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    // React already escapes everything it renders; doing it again turns an apostrophe
    // into &#39; on screen.
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  return i18n;
}

/**
 * The locale `Intl` should format against.
 *
 * Not the device locale, which is what `Intl` picks on its own. Someone running an
 * English phone who has set this app to French through the system's per-app language
 * setting should get French copy *and* French number grouping — `1 234,5 Ko`, not
 * `1,234.5 KB` sitting in the middle of a French sentence.
 *
 * Read on each call rather than captured, so it is correct however early a module is
 * imported: `formatBytes` is reached from module scope in places, and a value captured
 * at import time would be whatever `createInstance` starts with.
 */
export const activeLocale = (): string => i18n.language || 'en';
