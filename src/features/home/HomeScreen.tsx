// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Screen, Text, TaskTile } from '@/components';
import { fileGateway } from '@/native';
import { useBatchStore } from '@/store/batch';
import { useConversionStore } from '@/store/conversion';
import { useTheme } from '@/theme';
import {
  CONVERSION_TASKS,
  isTaskAvailable,
  isTileInteractive,
  type ConversionTask,
} from './tasks';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

/**
 * Launch surface.
 *
 * Tapping a tile opens the system picker immediately rather than routing to an
 * intermediate screen. That is what keeps a common conversion inside three taps —
 * tile, pick, convert — which `e2e/three-taps.yaml` asserts rather than assumes.
 */
export function HomeScreen({ navigation }: Props) {
  const theme = useTheme();
  const setSource = useConversionStore((s) => s.setSource);
  const setPicking = useConversionStore((s) => s.setPicking);
  const fail = useConversionStore((s) => s.fail);
  const resetBatch = useBatchStore((s) => s.reset);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

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
      setBusyTaskId(task.id);
      setPicking();
      try {
        // 0 is unlimited. The batch is the normal case; a single file is just the
        // smallest one, and it gets the detail screen because there is room to show
        // before-and-after properly.
        const picked = await fileGateway.pickPhotos(0);
        const first = picked[0];
        if (!first) {
          // The user backed out of the picker. Not an error; just nothing to do.
          useConversionStore.getState().reset();
          return;
        }

        if (picked.length === 1) {
          setSource(first);
          navigation.navigate('Convert', { taskId: task.id });
          return;
        }

        // Seed the sources and let the batch screen submit, so it is mounted and
        // listening before the first progress event can arrive.
        resetBatch();
        useBatchStore.setState({ sources: picked, status: 'idle' });
        navigation.navigate('Batch', { taskId: task.id });
      } catch (error) {
        fail({
          code: 'unknown',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        pickInFlight.current = false;
        setBusyTaskId(null);
      }
    },
    [navigation, setSource, setPicking, fail, resetBatch],
  );

  return (
    <Screen scroll>
      <View style={{ marginBottom: theme.space['3xl'] }}>
        <Text variant="display">Convert</Text>
        <Text variant="body" color="textSecondary" style={{ marginTop: theme.space.sm }}>
          Everything happens on your device. Nothing is uploaded, nothing is tracked, and
          there is no limit.
        </Text>
      </View>

      <View style={styles.grid}>
        {CONVERSION_TASKS.map((task) => {
          const available = isTaskAvailable(task);
          return (
            <View key={task.id} style={[styles.cell, { padding: theme.space.sm }]}>
              <TaskTile
                testID={`task-${task.id}`}
                title={task.title}
                subtitle={available ? task.subtitle : 'Coming in a later build'}
                from={task.from}
                to={task.to}
                enabled={isTileInteractive(task, busyTaskId)}
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
  // Negative margin cancels the per-cell padding so the grid aligns with the page edge.
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 },
  cell: { width: '50%' },
});
