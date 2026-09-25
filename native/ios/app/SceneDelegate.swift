// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import React
import UIKit

/// Owns the app's window, because UIKit now insists that a scene does.
///
/// Built with the iOS 27 SDK, an app that still creates its window in the app delegate is
/// stopped at launch, before the first frame. Expo's template still does exactly that, so
/// `plugins/withSceneLifecycle.js` removes the window from `AppDelegate` and React Native
/// starts here instead, in a window that belongs to this scene.
///
/// Under scenes UIKit also stops telling the app delegate about opened URLs and about moving
/// between foreground and background. Both are forwarded to it unchanged, so Expo's
/// subscribers and React Native's `Linking` see exactly what they saw before the move.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene,
              let appDelegate = UIApplication.shared.delegate as? AppDelegate,
              let factory = appDelegate.reactNativeFactory else { return }

        let window = UIWindow(windowScene: windowScene)
        self.window = window
        // Code that finds the window through the app delegate keeps finding it.
        appDelegate.window = window

        // A file opened with the app from cold arrives with the scene, not in the launch
        // options. `Linking.getInitialURL` reads the launch options, so it goes back there;
        // without this the file that launched the app would be dropped.
        var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
        if let url = connectionOptions.urlContexts.first?.url {
            launchOptions[.url] = url
        }
        if let activity = connectionOptions.userActivities.first {
            launchOptions[.userActivityDictionary] = [
                UIApplication.LaunchOptionsKey.userActivityType: activity.activityType,
                "UIApplicationLaunchOptionsUserActivityKey": activity,
            ]
        }

        factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
    }

    /// A file opened with the app while it is already running.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        let application = UIApplication.shared
        for context in URLContexts {
            var options: [UIApplication.OpenURLOptionsKey: Any] = [
                .openInPlace: context.options.openInPlace,
            ]
            if let source = context.options.sourceApplication {
                options[.sourceApplication] = source
            }
            _ = application.delegate?.application?(application, open: context.url, options: options)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        let application = UIApplication.shared
        _ = application.delegate?.application?(
            application,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }

    // MARK: - Lifecycle, forwarded

    func sceneDidBecomeActive(_ scene: UIScene) {
        UIApplication.shared.delegate?.applicationDidBecomeActive?(.shared)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        UIApplication.shared.delegate?.applicationWillResignActive?(.shared)
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        UIApplication.shared.delegate?.applicationWillEnterForeground?(.shared)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        UIApplication.shared.delegate?.applicationDidEnterBackground?(.shared)
    }
}
