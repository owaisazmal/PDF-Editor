// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The mark's box on the splash screen, in points.
 *
 * Must equal `imageWidth` under `expo-splash-screen` in app.json, so that the launch
 * overlay's first frame is pixel for pixel the native splash screen's last. A test holds
 * the two together; this file exists so that test can read the number without importing
 * the animation.
 */
export const SPLASH_MARK_SIZE = 180;
