// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button, Card, Logo, Screen, SectionLabel, SegmentedControl, Text } from '@/components';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { APPEARANCE_MODES, useAppearanceStore, type AppearanceMode } from '@/store/appearance';
import { useTheme } from '@/theme';
import type { RootStackParamList } from '@/navigation/types';
import appConfig from '../../../app.json';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

/** Where the source lives. Also printed in the README, and the two must not drift. */
const SOURCE_URL = 'https://github.com/owaisazmal/PDF-Editor';

/** The number people are asked for in a bug report, read from the same place the stores read it. */
const VERSION = appConfig.expo.version;

/**
 * The app's own settings, as opposed to a conversion's.
 *
 * Deliberately short. Everything that changes how a file is converted belongs to the
 * conversion and is chosen on the way to it, where the effect is visible; what is left is
 * the handful of things that are true of the app rather than of one job. A settings screen
 * that collects every switch in the product is how an app ends up with a switch nobody can
 * find and nobody remembers deciding.
 */
export function SettingsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const mode = useAppearanceStore((state) => state.mode);
  const setMode = useAppearanceStore((state) => state.setMode);

  const openSource = useCallback(() => {
    // Failure is silent on purpose: there is nothing useful to say to someone whose device
    // has no browser, and an error card about a link is worse than a link that did nothing.
    void Linking.openURL(SOURCE_URL).catch(() => {});
  }, []);

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {});
  }, []);

  return (
    <Screen scroll>
      <Text variant="h1">{t('settings.title')}</Text>

      <Card style={{ marginTop: theme.space.xl }}>
        <SegmentedControl<AppearanceMode>
          label={t('settings.appearance')}
          testID="appearance"
          segments={APPEARANCE_MODES.map((value) => ({
            value,
            label: t(`settings.theme.${value}`),
          }))}
          value={mode}
          onChange={setMode}
        />
        <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.sm }}>
          {t('settings.themeHint')}
        </Text>
      </Card>

      {/* Answers the question the missing language picker creates, rather than leaving
          somebody to hunt for one that was never built. */}
      <Card style={{ marginTop: theme.space.lg }}>
        <SectionLabel>{t('settings.language')}</SectionLabel>
        <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.sm }}>
          {t('settings.languageHint', { count: Object.keys(SUPPORTED_LANGUAGES).length })}
        </Text>
        <Button
          testID="open-system-settings"
          label={t('settings.openSystemSettings')}
          variant="secondary"
          onPress={openSystemSettings}
          style={{ marginTop: theme.space.md }}
        />
      </Card>

      <Card style={{ marginTop: theme.space.lg }}>
        <SectionLabel>{t('settings.about')}</SectionLabel>

        {/*
          The mark, the name and the version, together, because this is the screen a bug
          report is written from. The name is not translated for the same reason the
          copyright line below is not: it is an identifier, and it reads the same everywhere.
        */}
        <View style={[styles.identity, { marginTop: theme.space.md, gap: theme.space.md }]}>
          <Logo size={44} testID="about-logo" />
          <View style={styles.identityText}>
            <Text variant="h3" heading={false}>
              Kitefold
            </Text>
            <Text variant="caption" color="textTertiary" testID="about-version">
              {t('settings.version', { version: VERSION })}
            </Text>
          </View>
        </View>

        <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.md }}>
          {t('settings.madeBy')}
        </Text>

        <Pressable
          testID="open-source"
          accessibilityRole="link"
          accessibilityLabel={t('settings.sourceLink')}
          onPress={openSource}
          style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text variant="bodySm" color="accentInk">
            {t('settings.sourceLink')}
          </Text>
        </Pressable>

        <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.md }}>
          {t('settings.privacy')}
        </Text>

        {/*
          The copyright and the licence, in the app rather than only in the repository.
          Both strings are fixed rather than translated: a copyright notice and the name of
          a licence are legal identifiers, and translating either would misstate it.
        */}
        <Text variant="caption" color="textTertiary" style={{ marginTop: theme.space.md }}>
          Copyright (c) 2026 Owais Khan{'\n'}Licensed under the Apache License, Version 2.0
        </Text>

        <Button
          testID="open-licenses"
          label={t('settings.licenses')}
          variant="secondary"
          onPress={() => navigation.navigate('Licenses')}
          style={{ marginTop: theme.space.md }}
        />
      </Card>

      <View style={{ marginTop: theme.space['2xl'] }}>
        <Button label={t('common.done')} variant="ghost" onPress={() => navigation.popToTop()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A full row rather than the text's own bounds, so the tap target clears 44pt.
  link: { paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  identity: { flexDirection: 'row', alignItems: 'center' },
  identityText: { flexShrink: 1 },
});
