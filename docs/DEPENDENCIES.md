# Proposed Dependencies

Copyright (c) 2026 Owais Khan
Licensed under the Apache License, Version 2.0

Status: **proposed — awaiting approval.** Nothing is installed yet.

**Permitted:** MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, Unlicense, Zlib.
**Forbidden:** GPL-2.0, GPL-3.0, AGPL, LGPL, SSPL, CC-BY-NC, any non-commercial or
research-only terms.

Two entries need an explicit allowlist decision before install — flagged **⚠ DECISION** and
summarised at the bottom.

---

## Runtime — JavaScript

| Package | License | Why |
|---|---|---|
| `react` | MIT | — |
| `react-native` ≥0.76 | MIT | New Architecture (Fabric + TurboModules) |
| `expo` | MIT | SDK + prebuild / CNG. Not Expo Go. |
| `expo-modules-core` | MIT | Config-plugin and module infrastructure |
| `expo-localization` | MIT | Device locale + RTL detection |
| `expo-file-system` | MIT | Temp/cache paths, atomic move targets |
| `expo-sharing` | MIT | Outbound share sheet |
| `expo-media-library` | MIT | Save to Photos (add-only permission) |
| `expo-document-picker` | MIT | Files / SAF document picking |
| `expo-clipboard` | MIT | Copy single image to clipboard |
| `expo-haptics` | MIT | Completion feedback |
| `expo-splash-screen` | MIT | Cold-start frame control |
| `expo-task-manager` | MIT | Background lifecycle registration |
| `@react-navigation/native` | MIT | — |
| `@react-navigation/native-stack` | MIT | — |
| `@react-navigation/bottom-tabs` | MIT | — |
| `react-native-screens` | MIT | Native screen containers |
| `react-native-safe-area-context` | MIT | — |
| `react-native-gesture-handler` | MIT | Drag-to-reorder, drag-and-drop |
| `react-native-reanimated` ≥4 | MIT | Requires New Architecture — aligned |
| `react-native-worklets` | MIT | Reanimated 4 peer |
| `react-native-edge-to-edge` | MIT | Android 15+ mandatory edge-to-edge |
| `zustand` | MIT | State |
| `react-native-mmkv` | MIT | Persistence. Wraps Tencent MMKV (**BSD-3-Clause**) |
| `react-native-nitro-modules` | MIT | MMKV v3 peer |
| `@shopify/flash-list` | MIT | 500-item batch lists without frame drops |
| `react-native-draggable-flatlist` | MIT | Page and image reordering |
| `i18next` | MIT | — |
| `react-i18next` | MIT | — |
| `react-native-svg` | MIT | Icons + SVG→raster rasterisation path |
| `react-native-view-shot` | MIT | iOS SVG rasterisation (no ImageIO SVG support) |
| `pdf-lib` | MIT | Only where the OS cannot help: metadata, page-tree surgery |
| `react-native-iap` | MIT | Non-consumable IAP + restore purchases |
| `zod` | MIT | Runtime validation of JobSpec at the native boundary |

## Runtime — analytics and ads: none

**Decision D2 is resolved: no third-party SDK ships in this app.**

| Package | Status |
|---|---|
| `react-native-google-mobile-ads` | **Not used.** Collects the advertising identifier; incompatible with the "No data collected" filing. |
| `@sentry/react-native` | **Not used.** Replaced by Xcode Organizer (iOS) and Play Console Android Vitals (Android) — free, no SDK, OS-level opt-in, data goes to Apple/Google rather than to us, so nothing appears on our privacy label. |
| Any analytics SDK | **Not used.** |

This is enforced, not just intended: a CI job greps the dependency tree for a denylist of known
ads/analytics/telemetry packages and fails the build if any appears, including transitively.

## Native — vendored C/C++ and Android libraries

| Library | License | Platform | Closes which gap |
|---|---|---|---|
| `libwebp` | BSD-3-Clause | both | Animated WebP encode; lossless WebP control on iOS |
| `libjpeg-turbo` | IJG / BSD-3-Clause / Zlib | Android | CMYK JPEG decode (`BitmapFactory` inverts or fails) |
| `libavif` | BSD-2-Clause | Android | AVIF encode |
| `libaom` | BSD-2-Clause + AOM Patent License 1.0 | Android | libavif encoder backend |
| `androidsvg` | Apache-2.0 | Android | SVG rasterisation |

**Decision D3 resolved: vendor all of them.** Every one is permissively licensed and zero-cost.
Android ships as an AAB with per-ABI splits, so an individual install carries roughly 6 MB of
native codecs rather than the full 24 MB across all four ABIs.

## Assets

| Asset | License | Note |
|---|---|---|
| Manrope | **SIL OFL-1.1** | **D5 approved.** OFL-1.1 is allowlisted for font assets in the CI licence gate. Attribution goes in `NOTICE` and the in-app licences screen. |
| SF Mono / Roboto Mono | system | Numeric readouts. On-device already; zero bytes added. |

## Development and CI

| Package | License |
|---|---|
| `typescript` | Apache-2.0 |
| `jest` | MIT |
| `@testing-library/react-native` | MIT |
| `@testing-library/jest-native` | MIT |
| `eslint` | MIT |
| `@typescript-eslint/*` | MIT |
| `eslint-plugin-react-hooks` | MIT |
| `prettier` | MIT |
| `maestro` | Apache-2.0 |
| `detox` | MIT |
| `license-checker-rseidelsohn` | BSD-3-Clause |
| `fastlane` | MIT |
| `mitmproxy` (CI only, not shipped) | MIT |
| XCTest / JUnit / Robolectric | Apple SDK / EPL-2.0 / MIT — test-only, never linked into the shipped binary |

## Explicitly rejected

| Rejected | License | Reason |
|---|---|---|
| FFmpeg | LGPL-2.1+, GPL-contaminated builds | Forbidden. Not needed. |
| MuPDF | AGPL-3.0 | Forbidden. PDFKit + PdfRenderer cover it. |
| Poppler | GPL-2.0 | Forbidden. |
| Ghostscript | AGPL-3.0 | Forbidden. |
| ImageMagick with GPL delegates | mixed | Forbidden. |
| LibRaw | LGPL-2.1 / CDDL | Forbidden — this is why Android CR2/NEF/ARW cannot ship. |
| dcraw | GPL-2.0 | Same. |
| `expo-image-picker` | MIT (licence is fine) | Rejected on **correctness**: can return a transcoded JPEG instead of the original HEIC, which silently breaks the app's headline conversion. Replaced by a custom `PHPickerViewController` / Photo Picker module. |

## Enforcement

- `npm run license:check` runs `license-checker-rseidelsohn` against an explicit allowlist and
  exits non-zero on anything outside it. Wired as a required GitHub Actions job.
- Native vendored libraries are not visible to the npm checker, so their licences are asserted
  by a separate script that hashes each vendored `LICENSE` file and fails on drift.
- `LICENSES.md` and the in-app **Open Source Licenses** screen are both generated from the same
  manifest, so they cannot disagree.
- `NOTICE` carries the Apache-2.0 attribution for `androidsvg` and any other Apache-2.0
  dependency requiring it.

## Allowlist as enforced by CI

```
MIT  Apache-2.0  BSD-2-Clause  BSD-3-Clause  ISC  MPL-2.0  Unlicense  Zlib
0BSD  Python-2.0  BlueOak-1.0.0  CC0-1.0
OFL-1.1        (font assets only — decision D5)
IJG            (libjpeg-turbo, alongside its BSD-3 and Zlib grants)
```

Anything outside this list fails the build. Decisions D2, D3 and D5 are all resolved; nothing
blocks install.

---

*Copyright (c) 2026 Owais Khan. Licensed under the Apache License, Version 2.0.*

---

## Maven dependencies (Android)

The licence gate reads the npm tree, so it cannot see Maven coordinates. These two are
checked by reading, declared in `plugins/withConverterCoreAndroid.js`, and attributed in
NOTICE as Apache-2.0 requires.

| Coordinate | License | Size | Why |
|---|---|---|---|
| `androidx.exifinterface:exifinterface` | Apache-2.0 | negligible | Reads and writes EXIF across formats, which the platform APIs cannot. |
| `com.tom-roush:pdfbox-android` | Apache-2.0 | 3.1 MB AAR, no native code | Page-level PDF work. Android exposes no page object: `PdfRenderer` only paints pages into bitmaps and `PdfDocument` only records canvas drawing, so merge, split and reorder with platform APIs alone would repaint every page and destroy its text. PDFBox also decrypts on every API level, where `PdfRenderer` gained a password API only in Android 15. |

**Why not the usual answer.** MuPDF, Poppler and Ghostscript are what most PDF apps use,
and all three are GPL or AGPL. That is the single reason most competitors either charge
for a commercial licence or cannot publish their source. PDFBox is the permissive
equivalent and costs nothing on either count.
