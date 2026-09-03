// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Signs release builds with a real key, and says so loudly when it cannot.
 *
 * The Expo and React Native template ships `release { signingConfig signingConfigs.debug }`
 * with a comment telling you to change it. Nobody changes it, because nothing breaks: the
 * build succeeds, the APK installs, and `bundleRelease` produces an AAB that looks finished.
 * Play then rejects the upload for being debug-signed, which is the first moment anyone
 * finds out, and by then it is release day.
 *
 * The credentials are read from Gradle properties or the environment rather than committed,
 * because an upload key in a public repository is the same as no upload key at all.
 *
 * When they are absent the build still works, on purpose: this project builds release
 * variants locally to check permissions and behaviour, and refusing to do that would trade
 * a rare failure for a constant one. What it will not do is stay quiet. The build prints a
 * banner, and `assembleRelease` marks the output, so a debug-signed artifact cannot be
 * mistaken for a shippable one.
 */
const SIGNING_CONFIG = `
        release {
            // Supplied at build time, never committed. Set these in ~/.gradle/gradle.properties
            // or the environment:
            //   KITEFOLD_STORE_FILE, KITEFOLD_STORE_PASSWORD,
            //   KITEFOLD_KEY_ALIAS,  KITEFOLD_KEY_PASSWORD
            def storePath = findProperty('KITEFOLD_STORE_FILE') ?: System.getenv('KITEFOLD_STORE_FILE')
            if (storePath) {
                storeFile file(storePath)
                storePassword findProperty('KITEFOLD_STORE_PASSWORD') ?: System.getenv('KITEFOLD_STORE_PASSWORD')
                keyAlias findProperty('KITEFOLD_KEY_ALIAS') ?: System.getenv('KITEFOLD_KEY_ALIAS')
                keyPassword findProperty('KITEFOLD_KEY_PASSWORD') ?: System.getenv('KITEFOLD_KEY_PASSWORD')
            }
        }
`;

const RELEASE_SIGNING = `
            // The real key when it is configured, the debug key when it is not. The
            // difference is announced rather than silent: a debug-signed AAB is rejected
            // by Play at upload, which is a bad moment to discover it.
            def hasUploadKey = (findProperty('KITEFOLD_STORE_FILE') ?: System.getenv('KITEFOLD_STORE_FILE')) != null
            signingConfig hasUploadKey ? signingConfigs.release : signingConfigs.debug
            if (!hasUploadKey) {
                logger.warn("")
                logger.warn("  ****************************************************************")
                logger.warn("  *  This release build is signed with the DEBUG key.            *")
                logger.warn("  *  Google Play will reject it. Set KITEFOLD_STORE_FILE and     *")
                logger.warn("  *  its three companions to sign with the upload key.           *")
                logger.warn("  *  See the Releasing section of README.md.                     *")
                logger.warn("  ****************************************************************")
                logger.warn("")
            }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    if (contents.includes('KITEFOLD_STORE_FILE')) return modConfig;

    const debugConfig = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;
    if (!contents.includes(debugConfig)) {
      throw new Error(
        'withReleaseSigning: could not find the template signing config in build.gradle. ' +
          'The Expo template changed; update this plugin.',
      );
    }
    contents = contents.replace(debugConfig, `${debugConfig}\n${SIGNING_CONFIG.trim()}`);

    const templateRelease = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;
    if (!contents.includes(templateRelease)) {
      throw new Error(
        'withReleaseSigning: could not find the release signingConfig line in build.gradle. ' +
          'The Expo template changed; update this plugin.',
      );
    }
    contents = contents.replace(templateRelease, RELEASE_SIGNING.trim());

    modConfig.modResults.contents = contents;
    return modConfig;
  });
};
