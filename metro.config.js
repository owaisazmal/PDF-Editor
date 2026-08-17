// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Test fixtures are binary assets read by native tests, never bundled into the app.
config.resolver.blockList = [/fixtures\/.*/, /ios\/ConverterCoreTests\/.*/];

module.exports = config;
