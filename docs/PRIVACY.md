# Privacy Policy

**Kitefold**
Copyright (c) 2026 Owais Khan
Licensed under the Apache License, Version 2.0

Last updated: 3 September 2026

## The short version

Kitefold collects nothing. It has no account, no analytics, no advertising, no crash
reporting service, and no server. Every conversion happens on your device, and the files
you convert never leave it.

This is not a promise about intent. The Android release build ships without the
`INTERNET` permission, so the operating system refuses network access to the app whatever
its code asks for. Automatic Backup is disabled, so Android does not copy the app's files
to Google Drive either.

## What the app stores

Everything below stays on your device. None of it is transmitted anywhere, because there
is nowhere for it to be transmitted to.

| What | Why | Where |
|---|---|---|
| Conversion history | So you can see what you converted and whether it saved anything | Local app storage |
| Saved presets | So you do not rebuild the same settings each time | Local app storage |
| Your last-used settings | So the app opens where you left it | Local app storage |
| Appearance choice | Light, dark, or follow the device | Local app storage |

The history holds counts, file sizes, output filenames, a timestamp and which conversion
you ran. It holds no file contents, no thumbnails, and no path to anything outside the
app's own storage. Clearing it from the History screen deletes it immediately.

## Files you convert

Files are read when you choose them, converted on the device, and written where you ask.

On both platforms the app uses the system file and photo pickers, which run outside the
app. That means Kitefold receives only the files you select and has no permission to read
your photo library or your storage. On iOS the app asks to *add* to your photo library and
never to read it; on Android it requests no storage or media permission at all.

Choosing a file through a system picker makes a working copy in the app's private cache,
because the reference a picker hands over is only valid for a moment. Those copies are
cleared the next time the app starts. Converted files stay in the app's private storage
until you save them somewhere or clear the app's data; nothing else can read that storage.

## Permissions

The Android release build requests four permissions and nothing else:

- `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_DATA_SYNC`, so a long batch keeps running
  when you leave the app. Install-time, no dialogue.
- `POST_NOTIFICATIONS`, the only permission you are ever asked about, so the batch can show
  progress. Refusing it does not stop a conversion; Android simply draws no notification.
- `VIBRATE`, for the tap you feel when a conversion finishes.

iOS asks for nothing except permission to add a converted image to your photo library, at
the moment you first save one.

## Children

Kitefold collects no data from anyone, of any age.

## Changes

If this policy ever changes, the change will appear in this file, and its history is
public in the repository below.

## Contact

Kitefold is made by Owais Khan. The source is at
[github.com/owaisazmal/PDF-Editor](https://github.com/owaisazmal/PDF-Editor), and issues and
questions are welcome there.
