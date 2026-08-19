// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

const { withAndroidManifest, withDangerousMod, withXcodeProject } = require('expo/config-plugins');

/**
 * Carries the app's nine languages into the two surfaces that cannot read the catalogue.
 *
 * The Android foreground service runs while no JavaScript is alive, and the iOS share
 * extension compiles the engine directly and runs none at all. Neither can reach i18next,
 * so both need their platform's own resources — `values-xx/strings.xml` and
 * `xx.lproj/Localizable.strings`.
 *
 * Those resources are generated from `src/i18n/locales/*.json` rather than hand-written
 * beside it. One catalogue, one place to translate, and a notification that cannot drift
 * out of step with the screen that started it. It also means the locale parity test covers
 * the notification and the share sheet, which a second set of files never would.
 *
 * The plugin also declares the language list to both operating systems. Neither the app nor
 * this plugin ships a language picker, because both platforms already have one — Settings ›
 * Converter › Language on iOS, and the same under App info on Android 13 and later — and
 * theirs relaunches the app, which is what changing to or from a right-to-left language
 * needs. What those pickers will not do is guess: iOS lists what `CFBundleLocalizations`
 * declares, and Android lists what `res/xml/locales_config.xml` declares.
 */

const generate = require('./localizations/generate');

const {
  readCatalogue,
  languagesIn,
  writeAndroidStrings,
  writeIosStrings,
} = generate;

/**
 * The pbxproj key of a target, by name.
 *
 * Two quirks of the `xcode` package meet here, and each one on its own produced a build
 * that succeeded while doing the wrong thing.
 *
 * `addTarget` stores the name it was given wrapped in literal quote characters, while the
 * lookups compare against the raw string — so a target this project created is invisible
 * to the functions meant to find it, and targets from the Expo template are not. That is
 * why the app received all nine localisations and the extension silently received none.
 *
 * And the key is what is wanted, not the object: `addResourceFile` passes `opt.target`
 * to `buildPhase`, which looks it up in the native-target section. Handing it the target
 * object instead of its key leaves `opt.target` undefined, and an undefined target does
 * not fail — it falls through to the first `Resources` phase in the file, which is the
 * app's. Every one of the extension's nine folders was being copied into the app.
 */
function findTargetKey(project, name) {
  return project.findTargetKey(name) ?? project.findTargetKey(`"${name}"`);
}

module.exports = function withLocalizations(config) {
  const languages = () => languagesIn(config._internal?.projectRoot ?? process.cwd());

  // 1. What iOS lists in its per-app language picker. Declared in the config rather than
  //    written into the plist afterwards, so `expo prebuild --clean` keeps it.
  config.ios = config.ios ?? {};
  config.ios.infoPlist = config.ios.infoPlist ?? {};
  config.ios.infoPlist.CFBundleLocalizations = languages().map((language) =>
    language === 'zh' ? 'zh-Hans' : language,
  );

  // 2. The Android resources, and the file the system picker reads.
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      writeAndroidStrings(
        readCatalogue(modConfig.modRequest.projectRoot),
        modConfig.modRequest.platformProjectRoot,
      );
      return modConfig;
    },
  ]);

  config = withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (application) application.$['android:localeConfig'] = '@xml/locales_config';
    return modConfig;
  });

  // 4. Reference each `.lproj` as a folder rather than as a variant group.
  //
  //    A variant group is what Xcode builds when a person adds a localisation by hand, and
  //    it is a great deal of pbxproj to synthesise correctly. A folder reference copies the
  //    directory into the bundle verbatim, which is all `NSLocalizedString`,
  //    `Localizable.stringsdict` and `CFBundleLocalizations` need — the lookup is by path
  //    inside the bundle, and it does not care how the path got there.
  return withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const appName = modConfig.modRequest.projectName;
    const groups = project.hash.project.objects.PBXGroup;

    // Written here rather than in an earlier `dangerous` mod, which is where this
    // naturally belongs and where it does not survive: `withShareExtension` clears
    // `ios/ShareExtension` wholesale before copying its sources in, and dangerous mods run
    // first — so the extension's `.lproj` folders were being written and then deleted,
    // leaving a pbxproj that referenced nine directories that were not there.
    writeIosStrings(
      readCatalogue(modConfig.modRequest.projectRoot),
      modConfig.modRequest.platformProjectRoot,
      appName,
    );

    for (const language of languages()) {
      project.addKnownRegion?.(language === 'zh' ? 'zh-Hans' : language);
    }

    /**
     * `addResourceFile` insists on a group called `Resources`.
     *
     * It calls `correctForResourcesPath` before it looks at the group it was handed, and
     * that helper dereferences `pbxGroupByName('Resources').path` unconditionally — so on
     * an Expo template, which has no such group, it throws before doing anything. Creating
     * one is the fix, and it has to carry no path of its own: a group with a path makes
     * the helper strip that prefix from every file added through it.
     */
    let resourcesKey = Object.keys(groups).find((key) => groups[key].name === 'Resources');
    if (!resourcesKey) {
      const rootKey = Object.keys(groups).find(
        (key) =>
          groups[key].name === undefined &&
          groups[key].path === undefined &&
          Array.isArray(groups[key].children),
      );
      if (!rootKey) throw new Error('withLocalizations: could not find the project root group.');

      const created = project.addPbxGroup([], 'Resources', '');
      delete groups[created.uuid].path;
      project.addToPbxGroup(created.uuid, rootKey);
      resourcesKey = created.uuid;
    }

    const attach = (targetName, prefix) => {
      const targetKey = findTargetKey(project, targetName);
      if (!targetKey) {
        /**
         * Loud, because the quiet version of this already happened.
         *
         * Expo applies config plugins in reverse registration order, so this one has to be
         * listed BEFORE `withShareExtension` in `app.json` to run after it. Listed the
         * other way round, the extension target does not exist yet, an early return
         * skipped it, and the build succeeded with an extension that had no localisations
         * in it — nine `.lproj` folders on disk, none in the `.appex`.
         */
        throw new Error(
          `withLocalizations: the ${targetName} target does not exist yet. List ` +
            './plugins/withLocalizations' +
            ` before the plugin that creates ${targetName} in app.json — Expo applies ` +
            'plugins in reverse order, so earlier in the list means later at prebuild.',
        );
      }

      for (const language of languages()) {
        const folder = `${prefix}${language}.lproj`;
        // `hasFile` is keyed on the corrected path, so ask before adding rather than
        // relying on the false return — a second pass through the mod chain would
        // otherwise add a duplicate build-file entry and Xcode would copy it twice.
        if (project.hasFile(folder)) continue;
        project.addResourceFile(
          folder,
          // A folder reference, not a group: Xcode copies the directory as it stands,
          // which is what keeps `xx.lproj/` intact inside the bundle.
          { target: targetKey, lastKnownFileType: 'folder' },
          resourcesKey,
        );
      }
    };

    attach('ShareExtension', 'ShareExtension/');
    attach(appName, `${appName}/`);

    return modConfig;
  });
};
