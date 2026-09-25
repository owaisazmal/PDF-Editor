// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * Picked copies and unsaved output are deleted once no screen can reach them, and never
 * while another store still holds them.
 */

import { routeToTask } from '@/features/home/routing';
import { CONVERSION_TASKS } from '@/features/home/tasks';
import { fileGateway } from '@/native';
import { useBatchStore } from '@/store/batch';
import { useConversionStore } from '@/store/conversion';
import { discardFiles } from '@/store/files';
import { useIncomingStore } from '@/store/incoming';
import { usePdfStore } from '@/store/pdf';
import type { PdfDocumentResult } from '@/engine/pdfClient';
import { conversionResult, detectedFile } from '../support/fixtures';

jest.mock('@/native', () => require('../support/nativeMock').createNativeMock());

const discard = fileGateway.discardFiles as jest.Mock;
const navigation = { navigate: jest.fn() };
const task = (id: string) => CONVERSION_TASKS.find((candidate) => candidate.id === id)!;

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Every URI handed to native so far. */
const discarded = async (): Promise<string[]> => {
  await settle();
  return discard.mock.calls.flatMap(([uris]) => uris as string[]);
};

const file = (name: string) => detectedFile('jpeg', { displayName: name });

const document = (name: string): PdfDocumentResult => ({
  outputUri: `file:///out/${name}`,
  outputDisplayName: name,
  pageCount: 1,
  byteSize: 1,
  elapsedMs: 1,
  beforeByteSize: 0,
});

beforeEach(async () => {
  useConversionStore.getState().reset();
  useBatchStore.getState().reset();
  usePdfStore.getState().reset();
  useIncomingStore.getState().clear();
  await settle();
  discard.mockClear();
});

it('skips files another store still holds', async () => {
  useIncomingStore.getState().add([file('held.jpg')]);

  discardFiles([file('held.jpg').uri, file('free.jpg').uri, file('free.jpg').uri]);

  expect(await discarded()).toEqual([file('free.jpg').uri]);
});

it('deletes a single conversion’s source and output when it is replaced', async () => {
  useConversionStore.setState({
    source: file('old.jpg'),
    result: conversionResult({ outputUri: 'file:///out/old.png' }),
  });

  useConversionStore.getState().setSource(file('new.jpg'));

  expect(await discarded()).toEqual([file('old.jpg').uri, 'file:///out/old.png']);
});

it('deletes a finished batch’s sources and output on reset', async () => {
  useBatchStore.setState({
    jobId: 'job-1',
    status: 'completed',
    sources: [file('a.jpg')],
    results: [conversionResult({ outputUri: 'file:///out/a.png' })],
  });

  useBatchStore.getState().reset();

  expect(await discarded()).toEqual([file('a.jpg').uri, 'file:///out/a.png']);
});

it('keeps the files a share hands to a task, and deletes the ones it left behind', async () => {
  const photo = file('photo.jpg');
  const pdf = detectedFile('pdf', { displayName: 'doc.pdf' });
  useIncomingStore.getState().add([photo, pdf]);

  routeToTask(navigation, task('compress-pdf'), [pdf]);
  useIncomingStore.getState().clear();

  expect(await discarded()).toEqual([photo.uri]);
  expect(usePdfStore.getState().sources).toEqual([pdf]);
});

it('deletes the previous PDF run’s output when the operation is run again', async () => {
  usePdfStore.setState({
    sources: [detectedFile('pdf')],
    status: 'done',
    documents: [document('first.pdf')],
  });

  await usePdfStore.getState().run(async () => ({ documents: [document('second.pdf')] }));

  expect(await discarded()).toEqual(['file:///out/first.pdf']);
  expect(usePdfStore.getState().documents).toEqual([document('second.pdf')]);
});

it('deletes the output of a PDF run the user left while it was working', async () => {
  let finish: (value: { documents: PdfDocumentResult[] }) => void = () => {};
  usePdfStore.setState({ sources: [detectedFile('pdf')], status: 'ready' });
  const running = usePdfStore.getState().run(() => new Promise((resolve) => (finish = resolve)));

  usePdfStore.getState().reset();
  finish({ documents: [document('late.pdf')] });
  await running;

  expect(await discarded()).toContain('file:///out/late.pdf');
  expect(usePdfStore.getState().documents).toEqual([]);
});
