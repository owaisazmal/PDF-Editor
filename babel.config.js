// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { reanimated: false }]],
    // react-native-worklets/plugin must stay last.
    plugins: ['react-native-worklets/plugin'],
  };
};
