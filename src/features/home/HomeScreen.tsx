// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Logo, Screen, Text, TaskTile } from '@/components';
import { fileGateway } from '@/native';
import { useCapabilitiesStore } from '@/store/capabilities';
import { useConversionStore } from '@/store/conversion';
import { useHistoryStore } from '@/store/history';
import { useTheme } from '@/theme';
import {
  CONVERSION_TASKS,
  isTileInteractive,
  unavailableReason,
  type ConversionTask,
} from './tasks';
import { blockedReason, routeToTask, type BlockedReason } from './routing';
import { errorKeyFor, type ErrorKey } from '@/features/convert/errors';
import type { RootStackParamList } from '@/navigation/types';

/**
 * One list for both platforms: iOS keeps the UTI, Android keeps the MIME type, and each
 * drops the identifier it does not recognise rather than failing on it.
 */
const PDF_PICKER_TYPES = ['com.adobe.pdf', 'application/pdf'];

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

/**
 * Launch surface.
 *
 * Tapping a tile opens the system picker immediately rather than routing to an
 * intermediate screen. That is what keeps a common conversion inside three taps —
 * tile, pick, convert. There is no end-to-end test asserting it; a comment here used to
 * cite `e2e/three-taps.yaml`, and no such file or harness has ever existed.
 */
/**
 * How many tiles fit across, by how wide the window is.
 *
 * Two was hardcoded, which is right on a phone and wrong on anything larger: on a 13-inch
 * iPad it produced tiles a thousand points wide holding two short lines of text, with the
 * whole grid finishing halfway down the screen. Measured against the window rather than a
 * device class, so a Split View pane and a small phone get the same answer for the same
 * reason.
 *
 * The four-column step sits at 1200 rather than 1000 because columns trade against rows.
 * A 13-inch iPad is 1032 points wide in portrait, and four columns put ten tiles into
 * three rows that end less than halfway down a 1376-point page — the same emptiness the
 * two-column version had, reached from the other direction. Three columns give four rows
 * and a tile with room to breathe. In landscape the window is 1376 wide and only 1032
 * tall, so four columns are right there, and the threshold picks that up on rotation.
 */
export function columnsFor(width: number): number {
  if (width >= 1200) return 4;
  if (width >= 700) return 3;
  return 2;
}

export function HomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const columns = columnsFor(width);
  const theme = useTheme();
  const setPicking = useConversionStore((s) => s.setPicking);
  const fail = useConversionStore((s) => s.fail);
  const capabilities = useCapabilitiesStore();
  const historyCount = useHistoryStore((state) => state.entries.length);

  // Asked once. The answer cannot change while the app is running — it is a property
  // of the OS build, not of anything the user can do.
  useEffect(() => {
    if (!capabilities.isLoaded) void capabilities.load();
  }, [capabilities]);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  /**
   * Why the last tap went nowhere.
   *
   * Held here rather than in the conversion store, which is where it used to go. Nothing
   * on this screen reads that store, so picking a single PDF for Merge set a failure
   * nobody rendered and the tile simply did nothing — no message, no navigation, no way
   * to tell a refusal from a bug.
   */
  const [blocked, setBlocked] = useState<ErrorKey | BlockedReason | null>(null);

  /**
   * Guards against opening two pickers at once. Deliberately a ref rather than the
   * `busyTaskId` state: state is also what dims the tapped tile, and the two need to
   * be able to diverge — see the focus effect below.
   */
  const pickInFlight = useRef(false);

  /**
   * Returning to this screen always restores a usable grid.
   *
   * A native picker that is dismissed in a way its delegate never observes leaves the
   * promise unresolved, and the `finally` that clears the busy flag never runs. That
   * used to disable every tile permanently, recoverable only by relaunching the app.
   * The Swift side now guarantees its continuation resumes, and this is the belt to
   * that pair of braces: whatever happened while the screen was away, arriving back
   * here means nothing is in flight.
   */
  useFocusEffect(
    useCallback(() => {
      pickInFlight.current = false;
      setBusyTaskId(null);
    }, []),
  );

  const startTask = useCallback(
    async (task: ConversionTask) => {
      if (pickInFlight.current) return;
      pickInFlight.current = true;
      // Cleared on the next attempt, not on a timer: the message is about the tap that
      // just happened, and it should stay until something else happens.
      setBlocked(null);
      setBusyTaskId(task.id);
      setPicking();
      try {
        // A PDF is never in the photo library, so a PDF task opens the document picker.
        // Composing one is the exception: its inputs are photos.
        const picked =
          task.picker === 'documents'
            ? await fileGateway.pickDocuments(PDF_PICKER_TYPES, true)
            : // 0 is unlimited. The batch is the normal case; a single file is just the
              // smallest one, and it gets the detail screen because there is room to
              // show before-and-after properly.
              await fileGateway.pickPhotos(0);

        const first = picked[0];
        if (!first) {
          // The user backed out of the picker. Not an error; just nothing to do.
          useConversionStore.getState().reset();
          return;
        }

        const reason = blockedReason(task, picked);
        if (reason) {
          setBlocked(reason);
          fail({ code: 'unknown', message: reason });
          return;
        }

        // The same route a shared file takes, so a share cannot skip a settings screen
        // that a picked file gets.
        routeToTask(navigation, task, picked);
      } catch (error) {
        // Shown as well as recorded. A picker that throws used to leave the grid looking
        // untouched, which reads as a tile that does not work.
        const key = errorKeyFor(error);
        setBlocked(key);
        fail({ code: 'unknown', message: key });
      } finally {
        pickInFlight.current = false;
        setBusyTaskId(null);
      }
    },
    [navigation, setPicking, fail],
  );

  return (
    <Screen scroll>
      <View style={{ marginBottom: theme.space['3xl'] }}>
        {/*
          A masthead: the mark on one side, the actions on the other, and the title on its
          own line beneath. The mark is not put beside the title because the title is a
          verb, and "Konvertieren" with a kite in front of it and two pills after it does
          not fit a phone.
        */}
        <View style={styles.header}>
          <Logo size={28} testID="home-logo" />

          <View style={styles.headerActions}>
            {/* Only once there is something to look at. An empty history behind a
                permanent button is a dead end offered on every launch. */}
            {historyCount > 0 ? (
              <Pressable
                testID="open-history"
                accessibilityRole="button"
                accessibilityLabel={t('home.historyLabel', { count: historyCount })}
                onPress={() => navigation.navigate('History')}
                style={({ pressed }) => [
                  styles.headerAction,
                  {
                    backgroundColor: theme.color.bgSunken,
                    borderRadius: theme.radius.pill,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Text variant="label" color="textSecondary" heading>
                  {t('home.history')}
                </Text>
              </Pressable>
            ) : null}

            {/* Always present, unlike History: it is where the appearance setting lives,
                and a setting nobody can reach is a setting nobody has. */}
            <Pressable
              testID="open-settings"
              accessibilityRole="button"
              accessibilityLabel={t('settings.title')}
              onPress={() => navigation.navigate('Settings')}
              style={({ pressed }) => [
                styles.headerAction,
                {
                  backgroundColor: theme.color.bgSunken,
                  borderRadius: theme.radius.pill,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text variant="label" color="textSecondary" heading>
                {t('settings.title')}
              </Text>
            </Pressable>
          </View>
        </View>
        <Text variant="display" style={{ marginTop: theme.space.md }}>
          {t('home.title')}
        </Text>
        <Text variant="body" color="textSecondary" style={{ marginTop: theme.space.sm }}>
          {t('home.promise')}
        </Text>

        {blocked ? (
          <Text
            testID="home-blocked"
            variant="bodySm"
            color="warningInk"
            // Announced without needing focus: the tap that caused this was on a tile
            // somewhere else on the grid, and nothing moves focus here.
            accessibilityLiveRegion="polite"
            style={{ marginTop: theme.space.md }}
          >
            {t(blocked)}
          </Text>
        ) : null}
      </View>

      <View style={styles.grid}>
        {CONVERSION_TASKS.map((task) => {
          // Two different reasons a tile can be closed, and the user is told which:
          // "not built yet" is a promise, "your device cannot" is a fact.
          const reason = unavailableReason(task, capabilities);
          return (
            <View
              key={task.id}
              style={[{ width: `${100 / columns}%` }, { padding: theme.space.sm }]}
            >
              <TaskTile
                testID={`task-${task.id}`}
                title={t(`tasks.${task.id}.title`)}
                subtitle={reason ? t(`home.unavailable.${reason}`) : t(`tasks.${task.id}.subtitle`)}
                from={task.from}
                to={task.to}
                enabled={isTileInteractive(task, busyTaskId, capabilities)}
                onPress={() => void startTask(task)}
              />
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAction: { paddingHorizontal: 16, paddingVertical: 8 },
  // Negative margin cancels the per-cell padding so the grid aligns with the page edge.
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 },
});
