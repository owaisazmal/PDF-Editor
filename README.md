# Converter

A free, fast, 100% on-device image and document converter. HEIC to JPG, WebP, PDF in
both directions, batch conversion, resize and compress — with no uploads, no account
and no paywall.

Copyright (c) 2026 Owais Khan
Licensed under the Apache License, Version 2.0

---

## What makes this different

Every competing converter is either a website that uploads your photos to someone
else's server, or an app that puts basic conversion behind a subscription. This one
does the work on the device, for free, with no limit.

That is a claim, so it is enforced rather than asserted:

| Claim | How it is enforced |
|---|---|
| No file ever leaves the device | Android release builds ship **without `android.permission.INTERNET`** — the OS makes a network request impossible. A CI job asserts the permission is absent. |
| No tracking, no analytics | `npm run telemetry:check` fails the build if any ads, analytics or telemetry package appears in the dependency tree, transitively included. |
| "No data collected" on both stores | The generated iOS privacy manifest is verified in CI to declare no tracking and no collected data types. Crash reports come from Xcode Organizer and Play Console Vitals, which need no SDK. |
| No copyleft dependency | `npm run license:check` fails on GPL, AGPL, LGPL, SSPL and non-commercial terms. |
| Accessible colour throughout | Every foreground/background pair in the design system is measured against WCAG AA by a test. |

---

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node | 24+ | The build scripts read TypeScript directly using Node's native type stripping. |
| Xcode | 16+ | iOS deployment target is 16.4, the floor React Native 0.86 supports. |
| CocoaPods | 1.15+ | |
| JDK | 17 or 21 | `brew install --cask temurin@17` |
| Android SDK | API 36 | Minimum supported device is API 26. |

This app **cannot run in Expo Go** — it ships custom native code. Use a development
build.

### Two environment gotchas

**The project path must not contain a space.** React Native's own build scripts call
`find` with the project path unquoted, so a directory like `~/Desktop/PDF Editor` fails
during `pod install` with `find: /Users/…/PDF: No such file or directory`. This is a
React Native limitation, not something this project can work around. Move or rename the
checkout so the path has no spaces:

```bash
mv ~/Desktop/Projects/"PDF Editor" ~/Desktop/Projects/converter
```

**Xcode 26.1.1 needs a compatibility shim, which is applied automatically.** Expo SDK 57
uses Swift syntax (`weak let`, SE-0481) that the Swift 6.2.1 compiler in Xcode 26.1.1
does not implement, and calls `abs` in a way that is ambiguous under its C++ interop
mode. `scripts/patch-expo-toolchain.mjs` runs on `postinstall`, probes the toolchain,
and rewrites those two constructs in `expo-modules-jsi` only when needed. On a newer
Xcode it detects support and does nothing, so it removes itself without anyone having
to remember. If you update Xcode and the shim stops reporting, that is the expected
outcome.

## Getting started

```bash
npm install
npm run generate        # emit native token and format tables, and the app icons
npm run prebuild        # generate ios/ and android/ from app.json
npm run ios             # or: npm run android
```

Android needs both toolchain variables set:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=$HOME/Library/Android/sdk
```

A debug APK carries every ABI and lands around 240 MB, which is enough to fail an
install on an emulator with a default disk. Build for the one architecture you are
running instead:

```bash
cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
```

`npm run verify` runs everything CI runs.

## Scripts

| Script | What it does |
|---|---|
| `npm run verify` | Typecheck, lint, generated-file freshness, licence gate, telemetry gate, tests |
| `npm run generate` | Regenerate `Tokens.swift`/`Tokens.kt` and `FormatTable.swift`/`FormatTable.kt` |
| `npm run tokens:check` | Fail if the generated token files are stale |
| `npm run formats:check` | Fail if the generated format tables are stale |
| `npm run license:report` | Regenerate `LICENSES.md` and run the licence gate |
| `npm run telemetry:check` | Fail if any data-collecting package is present |
| `npm test` | Jest |

---

## Architecture

The full document is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The short version:

**The batch queue lives in native code, not in JavaScript.** JavaScript submits one
declarative job and then only observes — it never loops over files, holds a buffer, or
schedules work. That single decision is what makes four things possible at once:

- **Converting while backgrounded.** iOS suspends the JavaScript runtime, so a
  JS-driven loop stalls mid-batch. A native queue under `beginBackgroundTask`, or an
  Android foreground service, does not.
- **A share extension that runs no JavaScript.** An iOS share extension has roughly a
  120 MB ceiling; booting React Native inside it is slow and risks being killed. A
  plain Swift class in a shared framework is neither.
- **Cancellation that actually cancels.** Only the owner of the operation objects can
  abort work already in flight.
- **A memory ceiling.** Per-file autorelease scoping and RAM-class-aware concurrency
  have to happen where the allocations happen.

```
JavaScript          features → store (zustand) → engine (capabilities, planner, jobClient)
                    ─────────── TurboModule boundary: JSON in, coalesced events out ───────────
ConverterCore       JobQueue · FormatDetector · RasterCodec · PdfEngine · FileGateway
                    ─────────── same framework, no JavaScript runtime ───────────
Peer clients        iOS Share Extension (Swift)      Android SEND target (Kotlin)
```

### Two sources of truth, compiled to three languages

`src/theme/tokens.ts` and `src/engine/formats.ts` are authored once and compiled into
Swift and Kotlin by `npm run generate`. The share extension and the Android share
target therefore render in the same design system and identify files by the same rules,
without a second copy of either table. CI fails if a generated file is stale.

### The extension is a claim, not a fact

A `.png` that is really a HEIC is a real case, and a converter that believes the
filename produces an output byte-identical to its input. Every decision is made from
magic bytes. `src/engine/detect.ts` is the readable reference implementation; the native
detectors mirror it; a conformance test runs the fixture corpus through all three.

## Repository layout

```
src/
  native/      TurboModule specs and typed wrappers
  engine/      format table, detection, options schema, planner
  features/    home, convert (more per phase)
  components/  design-system primitives — all token-driven
  store/       zustand slices
  theme/       tokens.ts, the contrast utility, the provider
  utils/
native/
  ios/ConverterCore/    Swift: ImageIO, PDFKit, vImage
  ios/generated/        Tokens.swift, FormatTable.swift
  android/converter/    Kotlin: ImageDecoder, PdfRenderer, PdfDocument
  android/generated/    Tokens.kt, FormatTable.kt
scripts/       generators and CI gates
__tests__/     unit and integration
docs/          architecture, dependencies, measured contrast
```

`ios/` and `android/` are generated by `expo prebuild` and are not the home of any
hand-written code — everything custom lives under `native/` and is applied during
prebuild, so `--clean` is always safe.

---

## Contributing

1. `npm run verify` must pass before a pull request.
2. **No colour literal outside `src/theme/tokens.ts`.** ESLint fails the build on a hex
   or `rgba()` value anywhere else. Colours written into converted image data — the
   background fill used when flattening transparency — live in `imageDefaults` and are
   deliberately outside the light and dark schemes, because a file converted in dark
   mode must not come out with a dark background.
3. **Adding a colour means updating `CONTRAST_CONTRACT`.** If a new pairing is not
   declared there, it is not checked.
4. **Adding a format means editing `src/engine/formats.ts` only.** Run
   `npm run formats:gen` and commit the generated tables.
5. **No dependency that collects data**, and none under a copyleft or non-commercial
   licence. Both gates run in CI.
6. Commit messages describe the change and why it was made.

## Licence

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party licences
are inventoried in [LICENSES.md](LICENSES.md) and shown in the app under
**Settings › Open Source Licenses**.
