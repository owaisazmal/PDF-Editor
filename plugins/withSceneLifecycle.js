// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

const {
  IOSConfig,
  withAppDelegate,
  withInfoPlist,
  withPlugins,
  withXcodeProject,
} = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Moves the iOS app onto UIKit's scene lifecycle.
 *
 * Built with the iOS 27 SDK, an app that still owns its window from the app delegate does
 * not launch at all: UIKit stops it with a trap in
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` before the first frame.
 * iOS 26 only logged the same thing, which is why every earlier build looked fine. Expo's
 * template for this SDK still builds the window in `didFinishLaunchingWithOptions`, so
 * three things change on every prebuild:
 *
 *   Info.plist     declares one window scene, owned by `SceneDelegate`
 *   AppDelegate    stops creating a window and starting React Native in it
 *   SceneDelegate  native/ios/app/SceneDelegate.swift, which does both once a scene exists
 *
 * The AppDelegate edit replaces the exact block Expo generates and fails the prebuild when
 * that block is missing. A template that has changed shape should stop the build, not ship
 * an app that starts React Native twice, or never.
 */

const SCENE_DELEGATE = 'SceneDelegate.swift';

/** Left in place of the removed block, and used to recognise an already-patched file. */
const MARKER = '// React Native starts in SceneDelegate, once UIKit has a window scene for it.';

const WINDOW_BLOCK =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif\n/;

const withSceneManifest = (config) =>
  withInfoPlist(config, (modConfig) => {
    modConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return modConfig;
  });

const withWindowlessAppDelegate = (config) =>
  withAppDelegate(config, (modConfig) => {
    const { language, contents } = modConfig.modResults;
    if (language !== 'swift') {
      throw new Error(`withSceneLifecycle: expected a Swift AppDelegate, found ${language}.`);
    }
    if (contents.includes(MARKER)) return modConfig;
    if (!WINDOW_BLOCK.test(contents)) {
      throw new Error(
        'withSceneLifecycle: the AppDelegate no longer contains the window block this plugin ' +
          'replaces. Check the Expo template and update WINDOW_BLOCK.',
      );
    }
    modConfig.modResults.contents = contents.replace(WINDOW_BLOCK, `\n    ${MARKER}\n`);
    return modConfig;
  });

const withSceneDelegateSource = (config) =>
  withXcodeProject(config, (modConfig) => {
    const { projectRoot, platformProjectRoot, projectName } = modConfig.modRequest;
    if (!projectName) {
      throw new Error('withSceneLifecycle: could not determine the Xcode project name.');
    }

    const source = path.join(projectRoot, 'native', 'ios', 'app', SCENE_DELEGATE);
    if (!fs.existsSync(source)) {
      throw new Error(`withSceneLifecycle: native/ios/app/${SCENE_DELEGATE} is missing.`);
    }
    fs.copyFileSync(source, path.join(platformProjectRoot, projectName, SCENE_DELEGATE));

    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: path.join(projectName, SCENE_DELEGATE),
      groupName: projectName,
      project: modConfig.modResults,
      projectName,
    });
    return modConfig;
  });

module.exports = function withSceneLifecycle(config) {
  return withPlugins(config, [withSceneManifest, withWindowlessAppDelegate, withSceneDelegateSource]);
};
