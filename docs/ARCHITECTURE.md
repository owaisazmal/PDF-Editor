# Architecture Proposal

Copyright (c) 2026 Owais Khan
Licensed under the Apache License, Version 2.0

Status: **decisions resolved — Phase 1 in progress.**

---

## Decisions, as resolved

| # | Decision | Outcome |
|---|---|---|
| **D1** | Screenshots vs. derived design system | **Proceed with a UI designed to suit the palette.** The token set in §4 is now the source of truth. |
| **D2** | Ads/Sentry vs. truthful "No data collected" | **No data collection, no third-party SDK.** No ad network, no crash-reporting SDK. See §0.3 for the free alternative that keeps the claim true. |
| **D3** | Native codec scope | **Vendor all of them** — libwebp, libjpeg-turbo, libavif+libaom, androidsvg. All permissively licensed and zero-cost. |
| **D4** | `#A85F1E` as text-safe orange | **Approved** — added to the palette. |
| **D5** | SIL OFL-1.1 in the CI licence gate | **Approved** — allowed for font assets so Manrope can ship. |

---

## 0. Three things I need from you before Phase 1

### 0.1 The attached image is a palette, not UI screenshots

You attached a four-swatch palette (`#FDFBD4`, `#D47E30`, `#8D5A2B`, `#825E34`) and named
Manrope. That gives me colour and typeface. It does **not** give me the type scale, corner
radii, spacing rhythm, elevation treatment, button/card anatomy, icon weight, or density —
all of which your brief names as the things the screenshots are the source of truth for.

I have derived a complete token set from the palette + Manrope and documented it in §4 with
every assumption marked. I have **not** written any UI code, per your instruction. Send the
actual screens and I will reconcile the derived tokens against them before Phase 1 UI work.

### 0.2 The palette's orange fails WCAG AA as a text colour

Measured contrast against the cream ground `#FDFBD4`:

| Foreground | On `#FDFBD4` | AA body (4.5) | AA large (3.0) |
|---|---|---|---|
| `#D47E30` orange | **2.92:1** | ✗ fail | ✗ fail |
| `#8D5A2B` mid brown | 5.49:1 | ✓ pass | ✓ pass |
| `#825E34` warm brown | 5.54:1 | ✓ pass | ✓ pass |

`#D47E30` cannot carry text or icon glyphs on cream, and it cannot be a thin 1px border
that conveys state. White text on `#D47E30` is 3.08:1 — also a fail for body copy.

**Proposed adjustment, not a substitution:** keep `#D47E30` exactly as-is for what it is good
at — large fills, illustration, progress bars, the selected-state background of a card — and
pair it with `#241708` ink (5.68:1 on the orange, passes). For orange *text*, introduce
`#A85F1E`, a darkened member of the same hue family, at 4.61:1 on cream. Nothing about the
palette's character changes; one derived shade is added so text has somewhere legal to live.

### 0.3 "No data collected" is incompatible with the ad slot and with Sentry

§4 of the brief requires Apple's Privacy Nutrition Label and Google Play Data Safety to read
**No data collected**, and requires that claim to be true. §2.7 requires an AdMob banner on
the result screen, and §4 permits Sentry crash reporting.

Both collect data. The Google Mobile Ads SDK reads the advertising identifier, device model,
OS, coarse locale and IP on every request — Play's Data Safety form requires disclosing
*Device or other IDs*, and Apple's label requires *Identifiers* and *Usage Data*, flagged as
**used for tracking**, which triggers the ATT prompt on iOS. Sentry transmits stack traces,
device model, OS version and IP, which Apple classes as *Diagnostics* and Play as *Crash logs*.

### RESOLVED — zero third-party SDKs, and crash reports anyway

**No ad network. No crash-reporting SDK. "No data collected" is filed and it is true.**

The free alternative that costs nothing and breaks nothing: **the platforms' own built-in crash
reporting.**

- **iOS** — Apple's crash reports arrive in Xcode Organizer and App Store Connect with symbolicated
  stack traces, device model, OS version and affected-user counts. No SDK, no code, no entitlement.
  The user opts in once at the OS level under *Settings → Privacy → Analytics & Improvements*, and
  the data goes to **Apple**, not to us. It is therefore not our collection and does not appear on
  our nutrition label.
- **Android** — Play Console's Android Vitals gives crash and ANR clusters with stack traces,
  device/OS breakdowns and user-perceived-crash-rate against a peer benchmark. Again: no SDK, opt-in
  at the OS level, data goes to **Google**.

This covers the realistic failure modes for an app whose entire workload is native image and PDF
decoding — those crash as native signals, which is exactly what both platforms capture best. A
JS-level SDK like Sentry would arguably see *less* of what matters here.

**Monetisation follows from the same decision.** With no ads, "Remove Ads" is not a coherent
product. The IAP becomes a straight **"Support Development"** non-consumable at $2.99, restorable,
plus an optional consumable tip tier. Purchases are handled entirely by StoreKit 2 and Play Billing;
no purchase data reaches us, so the label stays clean. Every conversion feature remains free and
unlimited, which was the plan regardless.

**Consequences to accept, stated plainly:** no revenue at launch beyond voluntary support; no
pre-release crash telemetry from internal builds unless testers opt in; and crash data is delayed
by hours rather than being near-real-time. That is the price of the claim, and the claim is the wedge.

---

## 1. The one architectural idea everything else follows from

**The batch queue lives in native code, not in JavaScript.**

JS submits one declarative `JobSpec` and then only observes. It does not loop over files, does
not hold buffers, does not schedule work. This single decision is what makes four separate
requirements achievable at once:

- **Background continuation** (§2.4). When iOS backgrounds the app the JS runtime is
  suspended. A JS-driven loop stops mid-batch. A native `OperationQueue` wrapped in
  `beginBackgroundTask` — or an Android foreground service — keeps running.
- **The share extension** (§2.2, acceptance criterion 3). An iOS share extension has a hard
  memory ceiling around 120 MB and must feel instant. Booting a React Native runtime inside it
  is slow and risks jetsam. If the queue is a plain Swift class inside a shared framework, the
  extension links the framework directly and runs zero JavaScript.
- **Real cancellation** (§2.4). "Cancel" must abort in-flight native work, not just stop
  enqueuing. Only the owner of the operation objects can do that.
- **Memory ceiling** (acceptance criterion 5). Peak RSS under 400 MB across 300 images
  requires per-file autorelease scoping and concurrency throttled by RAM class — decisions that
  have to be made where the allocations happen.

```
┌──────────────────────── JavaScript (orchestration only) ────────────────────────┐
│  features/  →  store/ (zustand)  →  engine/                                     │
│                                       ├── capabilities.ts   what this OS can do │
│                                       ├── planner.ts        JobSpec builder     │
│                                       └── jobClient.ts      typed queue client  │
└─────────────────────────────────┬───────────────────────────────────────────────┘
                                  │  TurboModule boundary
                                  │  JSON in, events out. No pixels cross this line.
┌─────────────────────────────────▼───────────────────────────────────────────────┐
│  ConverterCore   (ios/ConverterCore.framework  ·  android/converter AAR)         │
│                                                                                 │
│   JobQueue        bounded concurrency, cancel, progress, background lifetime    │
│   FormatDetector  magic-byte sniffing, never trusts the file extension          │
│   RasterCodec     decode → transform → encode                                   │
│   PdfEngine       render, compose, merge, split, rotate, compress, unlock       │
│   FileGateway     atomic writes, free-space check, SAF / security bookmarks,    │
│                   iCloud & Drive materialisation, filename sanitisation         │
└─────────────────────────────────┬───────────────────────────────────────────────┘
                                  │  same framework, no JS
                  ┌───────────────┴───────────────┐
                  │                               │
        iOS Share Extension            Android SEND target Activity
        (pure Swift/SwiftUI)           (pure Kotlin/Compose)
```

`ConverterCore` is a first-class product with its own test suite, not glue behind a bridge.
The RN app, the iOS share extension and the Android share target are three peer clients of it.

### 1.1 The TurboModule surface

Five modules, all `codegenNativeComponent`-generated from TS specs in `src/native/`:

| Module | Responsibility |
|---|---|
| `NativeFormatDetector` | Sniff magic bytes → format, codec, dimensions, alpha, animation + frame count, EXIF orientation, colour space, PDF page count and encryption state. Never decodes the full image. |
| `NativeRasterCodec` | Single-file decode/transform/encode. Used for previews and size estimation; the queue calls the same Swift/Kotlin class directly. |
| `NativePdfEngine` | Render pages to bitmaps, compose images to PDF, merge, split, rotate, reorder, rasterise-compress, unlock. |
| `NativeJobQueue` | `submit(JobSpec) → jobId`, `cancel(jobId)`, `retryFailed(jobId)`, plus a progress event stream. The spine. |
| `NativeFileGateway` | Pick, sniff, materialise remote files, check free space, atomically write, save to Photos/Downloads, ZIP. |

Events (`onFileProgress`, `onFileComplete`, `onJobComplete`) are coalesced natively to ~10 Hz
before crossing the bridge. Emitting per-file events at full speed for 500 files floods the
JS thread and is a common cause of janky progress UI in this category.

### 1.2 State reconciliation

Zustand mirrors queue state; native is authoritative. On `AppState` → `active`, JS calls
`getJobState(jobId)` and replaces its mirror wholesale. This is the only correct model when
native can make progress while JS is frozen.

---

## 2. Why not the obvious off-the-shelf pieces

**Not `expo-image-picker`.** On iOS it can hand back a transcoded JPEG rather than the original
HEIC. For a HEIC→JPG converter that is a silent, fatal bug: the app would be converting a file
the OS already converted. We need `PHPickerViewController` configured for the original file
representation and its exact UTI. That is a small custom TurboModule (`NativeFileGateway`),
and it is non-negotiable.

**Not FFmpeg, MuPDF, Poppler, Ghostscript, ImageMagick.** All excluded by §1's licence
constraints, as your brief already states. Nothing in the feature list needs them.

**Not Detox for the share-sheet test.** Detox and Maestro drive our app; acceptance criterion 3
starts in Apple's Photos app. That one flow needs XCUITest (which can cross app boundaries) and,
on Android, UI Automator. Everything else stays on Maestro.

**pdf-lib only where the OS genuinely cannot help.** In practice that is metadata rewriting and
lossless page-tree surgery. Rendering, composition and rasterisation all stay native.

---

## 3. What the operating systems cannot do

Your brief asks me to name these rather than silently drop them. Here they are, with a proposal
for each. Everything not listed is natively supported on both platforms.

| Capability | iOS | Android | Proposal |
|---|---|---|---|
| **AVIF encode** | ImageIO, iOS 16+ ✓ | ✗ no platform encoder | Bundle **libavif + libaom** (BSD-2 + AOM Patent License 1.0 — both permitted). ~4 MB per ABI. |
| **Animated WebP encode** | ✗ ImageIO writes static only | ✗ `Bitmap.compress` writes static only | Bundle **libwebp** (BSD-3, includes mux/demux). Also fixes lossless WebP control on iOS. Required for GIF ⇄ animated WebP in §2.2. |
| **Animated GIF encode** | ImageIO ✓ | ✗ no platform encoder | Covered by libwebp's companion path, or ~400 lines of LZW GIF writer in Kotlin. Recommend the small in-house writer — no new dependency. |
| **TIFF encode** | ImageIO ✓ | ✗ | In-house baseline TIFF writer (uncompressed + LZW), ~300 lines Kotlin. |
| **BMP encode** | ImageIO ✓ | ✗ | In-house, trivial. |
| **ICO export** | ✗ | ✗ | In-house on both — ICO is a container around PNG payloads. |
| **CMYK JPEG decode** | ImageIO ✓ correct | ✗ `BitmapFactory` fails or inverts on Adobe-APP14 CMYK | Bundle **libjpeg-turbo** (IJG/BSD-3/zlib) for the Android CMYK path only. |
| **Camera RAW** | ImageIO: DNG, CR2, CR3, NEF, ARW, RAF, ORF ✓ | DNG only, and only on devices whose vendor supports it | CR2/NEF/ARW are **not deliverable on Android**. Every permissive path is closed — LibRaw is LGPL/CDDL, dcraw is GPL. Ship DNG-where-available on Android and say so plainly in the store listing. This is a real, permanent gap. |
| **Encrypted PDF unlock** | PDFKit `unlock(withPassword:)` ✓ | ✗ `PdfRenderer` has no password API and throws | Implement the PDF standard security handler (RC4-40/128, AES-128, AES-256/R6) in Kotlin over `javax.crypto`. Well-specified in ISO 32000-2; roughly a week including tests. No dependency. |
| **SVG rasterise** | ✗ ImageIO does not rasterise SVG | ✗ | **androidsvg** (Apache-2.0) on Android; `react-native-svg` + `react-native-view-shot` on iOS, or a WKWebView snapshot. |
| **Live Photo → GIF/still** | PhotosUI + AVFoundation ✓ | n/a — no Live Photo concept | iOS-only feature, hidden on Android. |
| **PDF compress preserving text** | ✗ PDFKit cannot rewrite embedded image streams in place | ✗ | The brief specifies rasterise + recompress, which works but makes text non-selectable and unsearchable. I will warn in the UI before applying, and offer "images only" vs "flatten everything" once page-content inspection lands. |
| **Background conversion** | `beginBackgroundTask` ✓ no permission, no UI | Foreground service, which Android requires to post a notification | Implemented. See §3.1 — this is the app's only runtime permission, and refusing it costs the notification, not the conversion. |

### 3.2 Page-level PDF work needs a library on Android

PDFKit gives iOS a complete object-level PDF implementation. Android gives two halves and
no middle: `PdfRenderer` reads a document by painting pages into bitmaps, `PdfDocument`
writes one by recording canvas drawing, and nothing exposes a page object. Merging,
splitting or reordering with platform APIs alone would repaint every page — turning a
2 MB text document into a 40 MB one whose text can no longer be selected, searched, or
read aloud.

**Resolved: vendor Apache PDFBox** (`com.tom-roush:pdfbox-android`, Apache-2.0, 3.1 MB
AAR, no native code). Merge, split and page editing now move page objects on both
platforms, and every PDF operation is open on both. It also removes the password problem:
`PdfRenderer` gained a password API only in Android 15, while PDFBox decrypts on every
version this app supports, so an encrypted document behaves the same on a five-year-old
phone as on a new one.

MuPDF, Poppler and Ghostscript are what most PDF apps use for this, and all three are GPL
or AGPL — the single reason most competitors either pay for a commercial licence or cannot
publish their source. This is the same trade as D3, and the same answer.

**The one cost worth naming.** Android cannot hold a decrypted document across calls the
way iOS holds a `PDFDocument`, because `PdfRenderer` owns a file descriptor and permits
one open page at a time. So unlocking writes a **decrypted copy into the app's private
cache**, and everything downstream works on an ordinary PDF. That copy is deleted when the
session closes and again on the next launch, so a crash cannot leave one behind
indefinitely — but for as long as a session is open, a password-protected file exists in
plaintext in storage no other app can read without root. The password itself is used once,
to decrypt, and is never stored.

### 3.3 The share extension compiles the engine, not a bridge to it

The extension is a second Xcode target built by `plugins/withShareExtension.js`, because
`ios/` is regenerated on every prebuild and a target created by hand in Xcode would not
survive. It links `RasterCodec`, `PdfEngine` and `FormatDetector` directly and runs **no
JavaScript at all** — the reason the engine lives in native code rather than behind the
bridge that drives it. A share extension has a hard memory ceiling around 120 MB and has
to feel instant; booting a React Native runtime inside one is slow and risks being
jetsammed part-way through a conversion.

`JobQueue.swift` is the one file held back. It keeps a batch alive with
`UIApplication.shared.beginBackgroundTask`, and `UIApplication.shared` is unavailable to
app extensions — using it is grounds for rejection, not merely a compile error. The
extension converts sequentially instead, one file per pass, which is the right shape for
a 120 MB ceiling anyway. `APPLICATION_EXTENSION_API_ONLY = YES` on the target makes that
a compiler guarantee rather than a convention.

Four things about assembling an Xcode target from a plugin are worth recording, because
each cost a build cycle and none is discoverable from the error alone:

- `addTarget` already creates the copy-files phase that embeds the `.appex`. Adding
  another produces "Unexpected duplicate tasks".
- A build phase given a filename mints a second, unparented file reference for the same
  product, which CocoaPods rejects as a consistency issue. Reference the target's own
  `productReference` instead.
- A group carrying a `path` resolves its children against it, and a group given an
  undefined path serialises that literally as a folder named `undefined`. Shared sources
  belong in a group with no path at all.
- `addPbxGroup` creates file references for whatever it is given, and `addSourceFile`
  then silently does nothing for a path that already exists. The result builds cleanly
  and produces an extension whose principal class is not in its own binary — visible only
  as a share sheet entry that does nothing when tapped.

### 3.1 The one runtime permission

Android suspends a process shortly after the user switches away, which stops a long batch dead.
A foreground service is the only mechanism that grants a reprieve, and Android requires one to
post a notification. From API 33 posting a notification requires `POST_NOTIFICATIONS`.

That makes this the only runtime permission the app ever asks for, so it is worth being exact
about what it does and does not buy:

- **It is not a data permission.** It grants no access to files, contacts, location, or
  anything about the user. It permits the app to draw a row in the notification shade.
- **A refusal costs visibility, not capability.** `startForeground` succeeds either way and the
  batch runs to completion either way. Without the permission Android simply does not display
  the notification, and the job appears in the active-apps list instead. The batch screen says
  so in one line rather than leaving an unexplained absence.
- **It is asked for once, and late.** Never at launch. The request happens on the first batch
  large enough that the user might plausibly switch away — five files, or 40 MB, whichever comes
  first — and the fact that it has been asked is persisted so a refusal is never re-prompted.
  A single-file conversion finishes before a phone can be put down and never asks.

The notification is the running job rather than an advertisement for one: the count, the file
being worked on, a determinate progress bar, and a Cancel button that works without reopening
the app. Swiping the app out of recents cancels the batch through `onTaskRemoved` rather than
leaving it converting with no screen to return to.

Net new native dependencies proposed: **libwebp, libavif+libaom, libjpeg-turbo, androidsvg** —
all permissively licensed, all vendored as source and built by CMake in the Android
`externalNativeBuild` / an iOS XCFramework. Estimated Android APK growth: ~6 MB per ABI.
Decision D3 in §9 covers whether you want that trade.

---

## 4. Design tokens derived from the palette

Marked **[given]** where it comes from your palette and **[derived]** where I computed it.
Geometry in §4.4 remains **[assumed]** — it is the part the palette cannot tell me.

Every ratio below is machine-measured. The authoritative, always-current table is
[docs/CONTRAST.md](CONTRAST.md), regenerated from `src/theme/tokens.ts` by `npm run tokens:gen`
and verified in CI, so these numbers cannot drift from the shipped palette.

### 4.1 Light

| Token | Value | Source | Contrast |
|---|---|---|---|
| `bg.canvas` | `#FDFBD4` | [given] | — |
| `bg.surface` | `#FFFEF0` | [derived] | — |
| `bg.raised` | `#FFFFFF` | [derived] | — |
| `bg.sunken` | `#F4F0C2` | [derived] | — |
| `border.subtle` | `#E4DCA8` | [derived] | 1.4:1 on canvas |
| `border.strong` | `#C9BE86` | [derived] | 2.1:1 on canvas |
| `text.primary` | `#241708` | [derived] | **16.6:1** ✓ AAA |
| `text.secondary` | `#6F5027` | [derived] | **6.99:1** ✓ AA |
| `text.tertiary` | `#8D5A2B` | [given] | **5.49:1** ✓ AA |
| `brand.fill` | `#D47E30` | [given] | large fills only — see §0.2 |
| `brand.ink` | `#A85F1E` | [derived] | **4.61:1** ✓ AA |
| `brand.deep` | `#8D5A2B` | [given] | **5.49:1** ✓ AA |
| `brand.warm` | `#825E34` | [given] | **5.54:1** ✓ AA |
| `on.brandFill` | `#241708` | [derived] | **5.68:1** on `#D47E30` ✓ |
| `on.brandDeep` | `#FFFFFF` | [derived] | **5.79:1** on `#8D5A2B` ✓ |
| `shadow` | `rgba(36,23,8,·)` | [derived] | warm-tinted; never neutral black on cream |

### 4.2 Dark, derived to preserve hierarchy

The interesting result: **the orange changes job between themes.** On cream it is decorative
because it cannot pass contrast; on the dark warm ground it reaches 6.98:1 and becomes the
primary text accent. The brown that carried text in light mode steps back to borders and fills.
Same palette, roles swapped — which preserves the *relationships* rather than naively inverting
the values.

| Token | Value | Contrast on `#17110A` |
|---|---|---|
| `bg.canvas` | `#17110A` | — |
| `bg.surface` | `#211A11` | — |
| `bg.raised` | `#2C2317` | — |
| `border.subtle` | `#3A2E1D` | — |
| `text.primary` | `#FDFBD4` | **17.78:1** ✓ AAA |
| `text.secondary` | `#D8CFA4` | **11.94:1** ✓ AAA |
| `text.tertiary` | `#A99A6E` | **6.72:1** ✓ AA |
| `brand.ink` | `#D47E30` | **6.09:1** ✓ AA |
| `brand.fill` | `#D47E30` | with `#17110A` ink at 6.09:1 ✓ |
| `brand.deep` | `#8D5A2B` | surfaces and pressed states |

### 4.3 Type — Manrope [given], scale [assumed]

Manrope ships under the **SIL Open Font License 1.1**, which is *not* on your permitted list.
OFL is permissive, universally accepted for App Store and Play distribution, and compatible
with Apache-2.0 redistribution — but the CI licence gate will fail on it unless we explicitly
allow OFL-1.1 for font assets. Flagging so the allowlist change is deliberate, not a bypass.

| Role | Size / line | Weight |
|---|---|---|
| `display` | 34 / 40 | 800 |
| `h1` | 28 / 34 | 700 |
| `h2` | 22 / 28 | 700 |
| `h3` | 18 / 24 | 600 |
| `body` | 16 / 24 | 500 |
| `bodySm` | 14 / 20 | 500 |
| `label` | 13 / 16 | 600, +0.3 tracking |
| `caption` | 12 / 16 | 500 |

Your palette image sets its hex codes in a monospace face. I read that as intentional and
propose carrying it into the product: **numeric and technical readouts** — file sizes, pixel
dimensions, compression percentages, format signatures — use the platform mono (SF Mono /
Roboto Mono, both already on device, zero bytes added) with tabular figures. That makes the
before/after size comparison on the result screen — your stated shareable moment — line up in
columns instead of jittering.

### 4.4 Geometry [assumed — needs screenshots]

- **Radii:** 8 / 12 / 16 / 24 / pill. The palette image's container reads as ~12–16.
- **Spacing:** 4-point scale — 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Elevation:** three warm-tinted steps; on cream, neutral grey shadows read as dirt.

### 4.5 One source of truth, three languages

`src/theme/tokens.ts` is authored by hand. A prebuild step (`npm run tokens:gen`) emits
`ios/ConverterCore/Tokens.swift` and `android/.../Tokens.kt` from it, so the share extension and
the Android share target render in the same system without a second copy of the palette. A CI
check fails the build if the generated files drift, and a Jest test asserts every
foreground/background token pair in the system clears WCAG AA — which is how §0.2 stays fixed
rather than regressing.

---

## 5. Repository layout

```
/src
  /native      TurboModule TS specs + typed wrappers
  /engine      capabilities, planner, jobClient, format policy
  /features    home, picker, options, progress, result, history, presets, settings, about
  /components  design-system primitives, all token-driven
  /store       zustand slices
  /theme       tokens.ts + generator
  /i18n        9 locales
  /utils
/ios
  /ConverterCore      Swift framework: ImageIO, PDFKit, vImage, PDFKit unlock
  /ShareExtension     pure Swift, links ConverterCore, no JS runtime
  /ConverterCoreTests XCTest against /fixtures
/android
  /converter          Kotlin library: ImageDecoder, PdfRenderer, PdfDocument, ExifInterface
  /sharetarget        SEND / SEND_MULTIPLE Activity, Compose, no JS runtime
  /converter/src/test JUnit + Robolectric against /fixtures
/__tests__            unit + integration
/e2e                  Maestro flows + XCUITest/UIAutomator for the share-sheet flow
/fixtures             every format, EXIF variants, corrupt, CMYK, 16-bit, animated, huge, encrypted
/docs
```

---

## 6. Testing strategy for the 15 edge cases

Each of §3's fifteen cases gets a named fixture file and a test at the layer where the bug
actually lives — mostly native, since that is where pixels are.

Notable ones:

- **No network (criterion 2).** Three layers. (a) A CI job runs the Maestro conversion flow
  behind mitmproxy and fails on any flow recorded during the conversion window. (b) An iOS test
  scheme installs a `URLProtocol` that hard-fails every request; a full batch must still
  succeed. (c) Android debug builds ship a `network-security-config` denying all domains.
  If ads ship, the assertion narrows to "zero requests during conversion, ad requests only
  after the result screen renders" — which is weaker, and is part of decision D2.
- **Three taps to a conversion (§2.6).** An instrumented Maestro flow counts taps and asserts
  ≤3 from cold launch to a written output file.
- **Peak memory (criterion 5).** An XCTest metric on `XCTMemoryMetric` and an Android
  macrobenchmark, both against a 300-file fixture batch, failing over 400 MB.
- **Atomicity (case 10).** Test kills the process mid-batch and asserts the output directory
  contains only complete files — every write goes to a temp path and is `rename()`d on success.

---

## 7. Phased delivery — what Phase 1 actually contains

Phase 1 stops at a single working vertical slice, as you specified:

1. Expo prebuild scaffold, RN 0.76+, New Architecture on, TS strict, no Expo Go.
2. `ConverterCore` framework + Android library skeletons, both wired to CI.
3. All five TurboModule TS specs, with only `NativeFormatDetector` and the HEIC→JPEG path
   in `NativeRasterCodec` implemented.
4. Magic-byte format detection, complete for every format in the matrix — this is small,
   and everything downstream depends on it.
5. `src/theme/tokens.ts` + the Swift/Kotlin generator + the contrast test.
6. One screen: pick one HEIC via `PHPickerViewController` / Photo Picker → convert → save
   to Photos. Correct EXIF orientation handling from day one.
7. `LICENSE`, `NOTICE`, `LICENSES.md`, the CI licence gate, and GitHub Actions running
   typecheck, lint, Jest, licence check and both platform builds.

Phases 2–6 as you laid them out. I will stop for review at the end of each.

---

## 8. Known blockers in the environment

- **No JDK installed.** `java -version` fails on this machine. Android builds cannot run until
  a JDK 17 (or 21) is installed — Temurin via Homebrew is the usual route. Xcode 26.1.1 and
  Node 24.9.0 are fine.
- **Not a git repository.** I will `git init` at the start of Phase 1 unless you object.
- **Google Play closed testing.** A new personal developer account must run a closed test with
  12 testers for 14 continuous days before production. That is a 2-week wall clock item
  independent of engineering, so the closed track goes into the very first Play upload.

---

## 9. Decisions — all resolved

| # | Decision | Outcome |
|---|---|---|
| **D1** | Screenshots vs. derived system | Proceed with a UI designed to suit the palette. §4 tokens are the source of truth. |
| **D2** | Ads + crash SDK vs. truthful "No data collected" | **Zero third-party SDKs.** No ad network, no Sentry. Crash reporting via Xcode Organizer and Play Console Vitals — free, no SDK, data goes to Apple/Google under OS-level opt-in, so it is not our collection. IAP becomes "Support Development" $2.99 non-consumable + optional tip tier. See §0.3. |
| **D3** | Native codec scope | **Vendor all** — libwebp, libjpeg-turbo, libavif + libaom, androidsvg. All permissive, all zero-cost. AAB per-ABI splits mean each install carries ~6 MB, not 24 MB. |
| **D4** | `#A85F1E` text-safe orange | Approved, added to the palette. |
| **D5** | SIL OFL-1.1 for font assets | Approved, allowlisted in the CI licence gate. |

### Remaining environment blocker

**No JDK on this machine.** Android sources will be written and reviewed, but cannot be compiled
locally until JDK 17 or 21 is installed:

```
brew install --cask temurin@17
```

iOS builds are unaffected (Xcode 26.1.1, Node 24.9.0 both present).

---

*Copyright (c) 2026 Owais Khan. Licensed under the Apache License, Version 2.0.*
