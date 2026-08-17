// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '@/theme';

export type ScreenProps = {
  children: ReactNode;
  /** Wraps content in a ScrollView. Off for screens that manage their own list. */
  scroll?: boolean;
  edges?: readonly Edge[];
  contentStyle?: ViewStyle;
};

/**
 * The page ground. Paints the canvas token explicitly rather than inheriting, and
 * matches the status bar to the scheme so the notch area does not flash the wrong
 * colour on a theme change.
 */
export function Screen({
  children,
  scroll = false,
  edges = ['top', 'left', 'right'],
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();
  const Body = scroll ? ScrollView : View;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.color.bgCanvas }]} edges={edges}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Body
        style={styles.fill}
        contentContainerStyle={
          scroll
            ? [{ padding: theme.space.xl, paddingBottom: theme.space['6xl'] }, contentStyle]
            : undefined
        }
        {...(scroll
          ? { showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: 'handled' as const }
          : {})}
      >
        {scroll ? children : <View style={[styles.fill, { padding: theme.space.xl }, contentStyle]}>{children}</View>}
      </Body>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
