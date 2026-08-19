// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // The real one is a native module and throws on import under Jest. The mock is an
    // in-memory store with the same surface, so the persistence rules stay testable.
    '^react-native-mmkv$': '<rootDir>/__mocks__/react-native-mmkv.ts',
  },
  testMatch: ['<rootDir>/__tests__/**/*.test.ts', '<rootDir>/__tests__/**/*.test.tsx'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
