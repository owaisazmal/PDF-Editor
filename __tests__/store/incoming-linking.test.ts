// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * File URLs arriving through linking are an iOS door only. On Android another app could
 * use one to point the app at its own private files.
 */

import { Linking, Platform } from 'react-native';

import { formatDetector } from '@/native';
import { useIncomingStore, watchIncomingFiles } from '@/store/incoming';
import { detectedFile } from '../support/fixtures';

jest.mock('@/native', () => {
  const mock = require('../support/nativeMock').createNativeMock();
  mock.fileGateway.onFilesReceived = jest.fn(() => jest.fn());
  return mock;
});

const detect = formatDetector.detect as jest.Mock;
const settle = () => new Promise((resolve) => setImmediate(resolve));

function sendUrl(os: typeof Platform.OS, url: string) {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  let handler: ((event: { url: string }) => void) | undefined;
  const listen = jest.spyOn(Linking, 'addEventListener').mockImplementation((_type, listener) => {
    handler = listener as typeof handler;
    return { remove: jest.fn() } as never;
  });
  try {
    const stop = watchIncomingFiles();
    handler!({ url });
    stop();
  } finally {
    listen.mockRestore();
    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
  }
}

beforeEach(() => {
  useIncomingStore.setState({ files: [] });
  detect.mockReset().mockResolvedValue(detectedFile('jpeg'));
});

it('ignores a file URL sent through linking on Android', async () => {
  sendUrl('android', 'file:///data/user/0/com.owaiskhan.kitefold/files/ConvertedFiles/a.jpg');
  await settle();

  expect(detect).not.toHaveBeenCalled();
  expect(useIncomingStore.getState().files).toHaveLength(0);
});

it('takes a file URL from Open In on iOS', async () => {
  sendUrl('ios', 'file:///private/var/mobile/Documents/Inbox/b.jpg');
  await settle();

  expect(detect).toHaveBeenCalledWith('file:///private/var/mobile/Documents/Inbox/b.jpg');
  expect(useIncomingStore.getState().files).toHaveLength(1);
});

it('takes the same Open In file again once the earlier copy was dealt with', async () => {
  const url = 'file:///private/var/mobile/Documents/Inbox/c.pdf';
  sendUrl('ios', url);
  await settle();
  useIncomingStore.setState({ files: [] });

  sendUrl('ios', url);
  await settle();

  expect(detect).toHaveBeenCalledTimes(2);
  expect(useIncomingStore.getState().files).toHaveLength(1);
});
