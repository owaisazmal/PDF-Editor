// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

const expoConfig = require('eslint-config-expo/flat');

/** Colours and shadows may only be authored in the token source of truth. */
const HEX_COLOUR = String.raw`^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`;
const CSS_COLOUR_FN = String.raw`^(?:rgba?|hsla?)\(`;

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'node_modules/**',
      'ios/**',
      'android/**',
      '.expo/**',
      'dist/**',
      'coverage/**',
      'fixtures/**',
      'docs/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${HEX_COLOUR}/]`,
          message:
            'Hardcoded colour. Every colour must come from src/theme/tokens.ts — see docs/ARCHITECTURE.md §4.',
        },
        {
          selector: `Literal[value=/${CSS_COLOUR_FN}/]`,
          message:
            'Hardcoded colour. Every colour must come from src/theme/tokens.ts — see docs/ARCHITECTURE.md §4.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['useColorScheme'],
              message: 'Use useTheme() from src/theme so tokens stay the single source of truth.',
            },
          ],
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The token file is where colours are allowed to be literal values.
    files: ['src/theme/tokens.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['__tests__/**/*.{ts,tsx}', 'scripts/**/*.mjs', 'plugins/**/*.js'],
    // Build scripts run in Node, not React Native, so they get Node's globals and are
    // free to log and to write literal colours.
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'writable',
      },
    },
    rules: { 'no-restricted-syntax': 'off', 'no-console': 'off' },
  },
];
