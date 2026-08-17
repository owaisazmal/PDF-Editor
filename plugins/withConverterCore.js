// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

const { IOSConfig, withXcodeProject } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Adds ConverterCore to the generated Xcode project.
 *
 * `ios/` is disposable — `expo prebuild --clean` regenerates it from scratch — so no
 * hand-written code can live there. Everything real lives under `native/ios/` and is
 * copied in and registered by this plugin on every prebuild. That is what makes
 * Continuous Native Generation safe to actually use rather than something to avoid
 * once custom native code exists.
 *
 * Source directories, in the order they are copied:
 *   native/ios/generated/    Tokens.swift and FormatTable.swift, from the TS sources
 *   native/ios/ConverterCore/ the Swift engine
 *   native/ios/bridge/       the @objc facade and the TurboModule shim
 */
const SOURCE_DIRECTORIES = ['generated', 'ConverterCore', 'bridge'];

/** Where the files land inside the Xcode project, and the group they appear under. */
const GROUP_NAME = 'ConverterCore';

/** Compiled, so they join the target's Sources build phase. */
const COMPILED_EXTENSIONS = new Set(['.swift', '.m', '.mm', '.c', '.cpp']);

/** Copied so `#import` can find them, but never added to a build phase. */
const HEADER_EXTENSIONS = new Set(['.h', '.hpp']);

module.exports = function withConverterCore(config) {
  return withXcodeProject(config, (modConfig) => {
    const projectRoot = modConfig.modRequest.projectRoot;
    const platformRoot = modConfig.modRequest.platformProjectRoot; // <project>/ios
    const appName = modConfig.modRequest.projectName;

    if (!appName) {
      throw new Error('withConverterCore: could not determine the Xcode project name.');
    }

    const destinationDirectory = path.join(platformRoot, appName, GROUP_NAME);
    fs.rmSync(destinationDirectory, { recursive: true, force: true });
    fs.mkdirSync(destinationDirectory, { recursive: true });

    const copied = [];

    for (const directory of SOURCE_DIRECTORIES) {
      const source = path.join(projectRoot, 'native', 'ios', directory);
      if (!fs.existsSync(source)) {
        throw new Error(
          `withConverterCore: native/ios/${directory} is missing. ` +
            'Run `npm run generate` if the generated sources have not been produced yet.',
        );
      }

      for (const entry of fs.readdirSync(source)) {
        const extension = path.extname(entry);
        const isCompiled = COMPILED_EXTENSIONS.has(extension);
        if (!isCompiled && !HEADER_EXTENSIONS.has(extension)) continue;

        fs.copyFileSync(path.join(source, entry), path.join(destinationDirectory, entry));
        if (isCompiled) copied.push(entry);
      }
    }

    if (copied.length === 0) {
      throw new Error('withConverterCore: no native sources were found to copy.');
    }

    // Register each file with the app target so it actually compiles. Paths are
    // relative to ios/, which is what the pbxproj stores.
    for (const filename of copied) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: path.join(appName, GROUP_NAME, filename),
        groupName: `${appName}/${GROUP_NAME}`,
        project: modConfig.modResults,
        projectName: appName,
      });
    }

    return modConfig;
  });
};
