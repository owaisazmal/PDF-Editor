// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The whole `@/native` surface, mocked in one place.
 *
 * Screens import the module rather than individual functions, and `src/native/index.ts`
 * evaluates some of its exports at import time — `detectFile = formatDetector.detect`
 * runs on require, so a partial mock fails while the module is still loading, with an
 * error that names a line no test wrote. Mocking the whole surface once keeps that
 * failure from being rediscovered per screen.
 *
 * Used as `jest.mock('@/native', () => require('../support/nativeMock').createNativeMock())`,
 * which is the form Jest allows: the factory is hoisted above the imports, so it may not
 * close over anything, but it may require.
 */

export function createNativeMock() {
  return {
    isNativeAvailable: () => true,

    formatDetector: {
      detect: jest.fn().mockResolvedValue(null),
      detectMany: jest.fn().mockResolvedValue([]),
      capabilities: jest.fn().mockResolvedValue({}),
    },

    rasterCodec: {
      convert: jest.fn().mockResolvedValue(null),
      estimateByteSize: jest.fn().mockResolvedValue(780_000),
      makePreview: jest.fn().mockResolvedValue('file:///tmp/preview.jpg'),
    },

    fileGateway: {
      pickPhotos: jest.fn().mockResolvedValue([]),
      pickDocuments: jest.fn().mockResolvedValue([]),
      saveToPhotos: jest.fn().mockResolvedValue(undefined),
      saveToDownloads: jest.fn().mockResolvedValue([]),
      shareFiles: jest.fn().mockResolvedValue(undefined),
      clearTemporaryFiles: jest.fn().mockResolvedValue(undefined),
      freeDiskSpace: jest.fn().mockResolvedValue(1_000_000_000),
    },

    jobQueue: null,

    /**
     * Present rather than null, because `pdfClient.isAvailable()` is `pdfEngine != null`
     * and a null engine makes every PDF screen render its "this build has no engine"
     * path — which is a real state, but not the one a screen test means to exercise.
     */
    pdfEngine: {
      inspect: jest.fn().mockResolvedValue({
        uri: 'file:///tmp/doc.pdf',
        pageCount: 4,
        isEncrypted: false,
        needsPassword: false,
        pages: [],
        title: 'doc',
      }),
      unlock: jest.fn().mockResolvedValue('session'),
      closeSession: jest.fn(),
      renderPages: jest.fn().mockResolvedValue([]),
      composeFromImages: jest.fn().mockResolvedValue(null),
      merge: jest.fn().mockResolvedValue(null),
      split: jest.fn().mockResolvedValue([]),
      editPages: jest.fn().mockResolvedValue(null),
      compress: jest.fn().mockResolvedValue(null),
    },
  };
}
