// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme';

export type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * The line under the field. Used for live feedback rather than static help — "8 of 40
   * pages" as the user types tells them the range parsed the way they meant.
   */
  hint?: string;
  /** Renders the hint as a problem rather than information. */
  hintIsProblem?: boolean;
  keyboardType?: KeyboardTypeOptions;
  secure?: boolean;
  autoFocus?: boolean;
  onSubmit?: () => void;
  testID?: string;
};

/**
 * A single-line text field on the token system.
 *
 * Two things in this app genuinely need typing — a page range and a PDF password — and
 * neither is a setting that a slider or a set of chips could express. Everything else
 * stays tappable.
 */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  hintIsProblem = false,
  keyboardType = 'default',
  secure = false,
  autoFocus = false,
  onSubmit,
  testID,
}: TextFieldProps) {
  const theme = useTheme();

  return (
    <View>
      <Text variant="bodySm" color="textPrimary">
        {label}
      </Text>

      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? ''}
        placeholderTextColor={theme.color.textTertiary}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        // A password field must never reach the keyboard's learned-words store, and a
        // page range is not worth autocorrecting into prose.
        autoComplete={secure ? 'off' : 'off'}
        spellCheck={false}
        onSubmitEditing={onSubmit}
        returnKeyType={onSubmit ? 'done' : 'default'}
        accessibilityLabel={label}
        {...(hint ? { accessibilityHint: hint } : {})}
        style={[
          styles.input,
          theme.text('body'),
          {
            marginTop: theme.space.sm,
            paddingHorizontal: theme.space.md,
            paddingVertical: theme.space.md,
            borderRadius: theme.radius.md,
            borderColor: theme.color.borderControl,
            backgroundColor: theme.color.bgSurface,
            color: theme.color.textPrimary,
          },
        ]}
      />

      {hint ? (
        <Text
          variant="caption"
          color={hintIsProblem ? 'warningInk' : 'textTertiary'}
          style={{ marginTop: theme.space.xs }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth },
});
