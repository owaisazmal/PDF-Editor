// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

import { useCallback, useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button, Card, FileRow, Screen, SectionLabel, TaskTile, Text } from '@/components';
import { FORMATS } from '@/engine/formats';
import { useCapabilitiesStore } from '@/store/capabilities';
import { useIncomingStore } from '@/store/incoming';
import { useTheme } from '@/theme';
import { formatBytes } from '@/utils/format';
import { blockedReason, routeToTask } from '@/features/home/routing';
import { applicableTasks, filesFor } from './applicable';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Incoming'>;

/**
 * What arrived from somewhere else, and what can be done with it.
 *
 * A share sheet gives files without a task — the opposite of the home screen, where the
 * task is chosen first. So this screen answers the question the user has not been asked
 * yet, and answers it with only the things that can actually work: a task that could take
 * none of these files is not offered, because offering it produces a screen whose only
 * possible outcome is an error.
 */
export function IncomingScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const files = useIncomingStore((state) => state.files);
  const clear = useIncomingStore((state) => state.clear);
  const capabilities = useCapabilitiesStore();

  const options = useMemo(() => applicableTasks(files, capabilities), [files, capabilities]);

  const start = useCallback(
    (taskId: string) => {
      const option = options.find((entry) => entry.task.id === taskId);
      if (!option) return;

      // Only the files the task can read. Handing a PDF task a photo that happened to be
      // in the same share is how a batch fails on a file the user never aimed at it.
      const usable = filesFor(option.task, files);
      if (blockedReason(option.task, usable)) return;

      // Cleared before navigating: these files now belong to the task's own store, and
      // leaving them here means coming back to this screen after finishing.
      clear();
      routeToTask(navigation, option.task, usable);
    },
    [options, files, clear, navigation],
  );

  const dismiss = useCallback(() => {
    clear();
    navigation.popToTop();
  }, [clear, navigation]);

  const unreadable = files.filter((file) => file.format === '').length;

  return (
    <Screen>
      <Text variant="h1">{t('incoming.title')}</Text>
      <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
        {t('incoming.subtitle', { count: files.length })}
      </Text>

      <ScrollView
        style={{ flex: 1, marginTop: theme.space.lg }}
        contentContainerStyle={{ paddingBottom: theme.space.xl }}
        showsVerticalScrollIndicator={false}
      >
        <Card>
          {files.map((file) => (
            <FileRow
              key={file.uri}
              name={file.displayName}
              detail={t('incoming.fileDetail', {
                format: FORMATS[file.format as keyof typeof FORMATS]?.label ?? t('common.unrecognised'),
                size: formatBytes(file.byteSize),
              })}
              state={file.format === '' ? 'failed' : 'done'}
            />
          ))}
        </Card>

        {unreadable > 0 ? (
          <Text variant="caption" color="warningInk" style={{ marginTop: theme.space.sm }}>
            {t('incoming.unreadable', { count: unreadable })}
          </Text>
        ) : null}

        {options.length > 0 ? (
          <>
            <SectionLabel style={{ marginTop: theme.space.xl }}>{t('incoming.whatToDo')}</SectionLabel>
            <View style={{ marginTop: theme.space.md, gap: theme.space.md }}>
              {options.map(({ task, matchCount }) => (
                <TaskTile
                  key={task.id}
                  from={task.from}
                  to={task.to}
                  title={t(`tasks.${task.id}.title`)}
                  // The count rather than the stock subtitle: with a mixed selection the
                  // useful thing to know is how much of it this task will take.
                  subtitle={
                    matchCount === files.length
                      ? t(`tasks.${task.id}.subtitle`)
                      : t('incoming.partial', { count: matchCount, total: files.length })
                  }
                  onPress={() => start(task.id)}
                />
              ))}
            </View>
          </>
        ) : (
          <Card style={{ marginTop: theme.space.xl }}>
            <Text variant="h3">{t('incoming.nothingUsable')}</Text>
            <Text variant="bodySm" color="textSecondary" style={{ marginTop: theme.space.xs }}>
              {t('incoming.nothingUsableBody')}
            </Text>
          </Card>
        )}
      </ScrollView>

      <View style={{ paddingTop: theme.space.md }}>
        <Button label={t('common.notNow')} variant="ghost" onPress={dismiss} />
      </View>
    </Screen>
  );
}
