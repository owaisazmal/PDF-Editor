# Store privacy questionnaires

Answers for the Google Play **Data safety** form and the App Store Connect **App Privacy**
section, written down rather than improvised at submission time. Both consoles ask their
questions in a fixed order; this file follows each one so the answers can be transcribed
without re-deciding anything.

Every answer here is a statement about the shipped binary, and each one names the evidence
that makes it checkable. If a future change makes one of these answers false, the gate that
should have caught it is named alongside.

---

## The short version

Kitefold collects nothing, transmits nothing, and contains no third-party SDK. Both
questionnaires reduce to "no data collected", and in the release build that is enforced by
the platform rather than by the code: `android.permission.INTERNET` is stripped from the
release manifest, so the process cannot open a socket even if a future dependency tried.

| | |
|---|---|
| Data collected | None |
| Data shared with third parties | None |
| Analytics / crash SDK | None |
| Advertising | None |
| Account required | No |
| Tracking (ATT) | No |
| Encryption | Standard OS APIs only; exempt |

---

## Google Play — Data safety

### Data collection and security

**Does your app collect or share any of the required user data types?**
> **No.**

Answering no closes the entire data-type matrix, so none of the Location, Personal info,
Financial info, Health, Messages, Photos and videos, Audio, Files and docs, Calendar,
Contacts, App activity, Web browsing, App info and performance, or Device or other IDs
sections need answers.

The one that invites a second look is **Photos and videos**. The app reads photos the user
picks and writes converted copies back. That is processing on the device, not collection:
Play defines collection as data *transmitted off the device*. Nothing is transmitted,
because nothing can be.

**Is all of the user data collected by your app encrypted in transit?**
> Not applicable — no data is collected or transmitted.

**Do you provide a way for users to request that their data is deleted?**
> Not applicable — no data leaves the device. Converted files the user has not saved are
> deleted when the app next launches, and clearing history is a control on the History
> screen.

### Data types — every section

> **None selected**, for every one of the fourteen categories.

### Additional questions

**Does your app contain ads?** No.
**Does your app have in-app purchases?** No.
**Is your app designed for families / does it target children?** Not directed at children;
no age-gated content. The app is rated for general audiences and collects nothing, so it
carries no additional obligations under Families policy.
**Does your app use a third-party analytics or attribution SDK?** No.

### Permissions Play will see in the manifest, and why

| Permission | Present in release? | Why |
|---|---|---|
| `FOREGROUND_SERVICE` | Yes | Keeps a running batch alive while the user switches away |
| `FOREGROUND_SERVICE_DATA_SYNC` | Yes | The Android 14+ type declaration for that service |
| `POST_NOTIFICATIONS` | Yes | The batch progress notification. Runtime-prompted; declining it does not stop a conversion |
| `INTERNET` | **No** | Removed from the release manifest by `plugins/withOfflineRelease.js` |
| `ACCESS_NETWORK_STATE` | **No** | Removed by the same plugin |
| `READ_MEDIA_IMAGES` | **No** | Blocked in `app.json`. The photo picker runs out of process and needs no permission |
| `READ_/WRITE_EXTERNAL_STORAGE` | **No** | Blocked in `app.json` |

`allowBackup` is `false`, so no app data is copied to Google's backup service.

---

## App Store Connect — App Privacy

### Data collection

**Do you or your third-party partners collect data from this app?**
> **No, we do not collect data from this app.**

This ends the questionnaire. Apple's definition of collect is "transmitting data off the
device in a way that allows you or your partners to access it for longer than necessary to
service the request". Kitefold transmits nothing.

As with Play, the category that deserves a deliberate answer is **User Content → Photos or
Videos**. The app reads and writes photos entirely on device. Apple's own guidance is
explicit that data processed only on the device and not sent anywhere is not collected.

### Tracking

**Does this app track users?** No. No data is linked to identity, no advertising
identifier is read, and there is no App Tracking Transparency prompt because there is
nothing to ask about.

### Privacy manifest (`PrivacyInfo.xcprivacy`)

Shipped in both the app and the share extension:

| Key | Value |
|---|---|
| `NSPrivacyTracking` | `false` |
| `NSPrivacyTrackingDomains` | empty |
| `NSPrivacyCollectedDataTypes` | empty |
| `NSPrivacyAccessedAPITypes` | File timestamp (`C617.1`), Disk space (`E174.1`) |

Both required-reason API declarations are real and minimal. File timestamps are read to
name output files and to sort history; free disk space is checked before encoding so a full
disk produces a clear message rather than a half-written file.

### Usage description strings

| Key | Purpose |
|---|---|
| `NSPhotoLibraryAddUsageDescription` | Saving converted images back to Photos |

There is deliberately **no** `NSPhotoLibraryUsageDescription`. Reading uses `PHPickerViewController`,
which runs out of process and returns only what the user selected, so the app never holds
read authorisation over the library.

### Export compliance

**Does your app use encryption?**
> Yes, but only encryption that is exempt.

`ITSAppUsesNonExemptEncryption` is set to `false` in `app.json`. The app performs no
cryptography of its own; the only encryption it touches is the operating system's, when
reading a password-protected PDF the user supplied the password for. That falls under the
standard exemption, so no CCATS or annual self-classification report is required.

### Account and sign-in

**Does the app require users to create an account?** No.
**Does the app offer account creation?** No.
**Is account deletion required?** Not applicable — there are no accounts.

---

## Content rating

Both stores' rating questionnaires answer "no" throughout: no violence, no sexual content,
no profanity, no controlled substances, no gambling, no user-generated content sharing, no
unrestricted web access, no location sharing, no personal information sharing. The app
converts image and document files chosen by the user and shows the result.

Expected outcomes: **IARC 3+ / Everyone** on Play, **4+** on the App Store.

---

## What would make these answers wrong

Each of these is enforced somewhere. The point of listing them is that a future change
breaking one of them should fail a gate, not a review.

| If this changed | The answer that breaks | What catches it |
|---|---|---|
| A dependency with an analytics SDK is added | "No third-party SDK" | `npm run telemetry:check` scans every package in the tree |
| A dependency starts making network calls | "Transmits nothing" | The unit-test network guard in `__tests__/setup.ts` fails any test that touches `fetch`, `XMLHttpRequest` or `WebSocket` |
| `INTERNET` is restored to the release manifest | "Cannot open a socket" | `plugins/withOfflineRelease.js` strips it; a change there is a visible diff in a small file |
| Converted files stop being cleared at launch | "Nothing persists that the user did not save" | Verified on device; `FileGateway.clearTemporaryFiles` clears both directories |
| The output directory loses its backup exclusion | "Nothing is copied to iCloud" | `RasterCodec.managedOutputDirectory` re-applies the flag on every call, not once at creation |
| A crash reporter is added | "No data collected" | Both of the first two gates |

---

## Hosting the policy

Both consoles require a publicly reachable privacy policy URL before submission.
`docs/PRIVACY.md` is the text. It is not yet hosted, and that is the one item on this page
that code cannot close.
