// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Screen, Text, TaskTile } from '@/components';
import { fileGateway } from '@/native';
import { useConversionStore } from '@/store/conversion';
import { useTheme } from '@/theme';
import { CONVERSION_TASKS, isTaskAvailable, type ConversionTask } from './tasks';
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
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const startTask = useCallback(
    async (task: ConversionTask) => {
      setBusyTaskId(task.id);
      setPicking();
      try {
        const picked = await fileGateway.pickPhotos(1);
        const first = picked[0];
        if (!first) {
          // The user backed out of the picker. Not an error; just nothing to do.
          useConversionStore.getState().reset();
          return;
        }
        setSource(first);
        navigation.navigate('Convert', { taskId: task.id });
      } catch (error) {
        fail({
          code: 'unknown',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyTaskId(null);
      }
    },
    [navigation, setSource, setPicking, fail],
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
                enabled={available && busyTaskId === null}
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
