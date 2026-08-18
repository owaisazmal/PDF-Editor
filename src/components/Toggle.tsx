// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { StyleSheet, Switch, View } from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme';

export type ToggleProps = {
  label: string;
  /** One line explaining what turning it off actually costs. */
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
};

/**
 * A labelled switch.
 *
 * The hint is part of the control rather than decoration: every toggle here changes
 * what the output file looks like, and "Convert to sRGB" means nothing without being
 * told what happens if you don't.
 */
export function Toggle({ label, hint, value, onChange, disabled = false, testID }: ToggleProps) {
  const theme = useTheme();

  return (
    <View style={[styles.row, { paddingVertical: theme.space.md }]}>
      <View style={styles.text}>
        <Text variant="bodySm" color={disabled ? 'textDisabled' : 'textPrimary'}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
            {hint}
          </Text>
        ) : null}
      </View>

      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        {...(hint ? { accessibilityHint: hint } : {})}
        trackColor={{ false: theme.color.bgSunken, true: theme.color.accentDeep }}
        thumbColor={theme.color.bgRaised}
        ios_backgroundColor={theme.color.bgSunken}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  text: { flex: 1 },
});
