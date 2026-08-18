// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

/**
 * The job client's job is to be strict on the way out and defensive on the way in.
 *
 * Native owns batch state and keeps working while the JavaScript runtime is suspended,
 * so anything arriving from it may be from a build that has moved on, or from a job
 * that was interrupted. Narrowing it here is what keeps the UI from having to render
 * states it has no design for.
 */

import { jobSpecSchema, narrowJobState, JOB_STATUSES } from '@/engine/jobClient';

const validSpec = {
  jobId: 'job-1',
  inputUris: ['file:///tmp/a.heic'],
  options: { targetFormat: 'jpeg' as const },
};

describe('outbound validation', () => {
  it('applies defaults so callers only state what they care about', () => {
    const parsed = jobSpecSchema.parse(validSpec);
    expect(parsed.outputDirectory).toBe('');
    expect(parsed.namePattern).toBe('');
    // Zero means "let native size the queue from the hardware".
    expect(parsed.maxConcurrency).toBe(0);
    expect(parsed.continueInBackground).toBe(true);
    expect(parsed.options.quality).toBe(82);
  });

  it('refuses a job with no inputs, which would otherwise complete instantly', () => {
    expect(() => jobSpecSchema.parse({ ...validSpec, inputUris: [] })).toThrow(/at least one/i);
  });

  it('refuses an empty jobId, which nothing could be correlated against', () => {
    expect(() => jobSpecSchema.parse({ ...validSpec, jobId: '' })).toThrow();
  });

  it('refuses an output format that cannot be written', () => {
    // RAW is import-only; the options schema is where that becomes an error rather
    // than a surprise at the end of a 500-file batch.
    expect(() => jobSpecSchema.parse({ ...validSpec, options: { targetFormat: 'dng' } })).toThrow(
      /not/i,
    );
  });
});

describe('inbound narrowing', () => {
  it('accepts a well-formed state unchanged', () => {
    const state = narrowJobState({
      jobId: 'job-1',
      status: 'running',
      progress: {
        jobId: 'job-1',
        completedCount: 2,
        failedCount: 1,
        totalCount: 10,
        fraction: 0.3,
        currentDisplayName: 'b.heic',
      },
      results: [{ outputUri: 'file:///tmp/a.jpg', byteSize: 100 }],
      failures: [{ uri: 'file:///tmp/b.heic', code: 'corrupt' }],
    });

    expect(state.status).toBe('running');
    expect(state.progress.completedCount).toBe(2);
    expect(state.results[0]?.outputUri).toBe('file:///tmp/a.jpg');
    expect(state.failures[0]?.code).toBe('corrupt');
  });

  it('treats an unrecognised status as failed rather than passing it through', () => {
    // A future native status must not leave the UI rendering nothing.
    expect(narrowJobState({ status: 'teleporting' }).status).toBe('failed');
    expect(JOB_STATUSES).toContain('failed');
  });

  it('clamps fraction, because a bar past 100% is a bug the user can see', () => {
    expect(narrowJobState({ progress: { fraction: 1.7 } }).progress.fraction).toBe(1);
    expect(narrowJobState({ progress: { fraction: -3 } }).progress.fraction).toBe(0);
    expect(narrowJobState({ progress: { fraction: Number.NaN } }).progress.fraction).toBe(0);
  });

  it('survives a completely empty or malformed payload', () => {
    for (const payload of [undefined, null, {}, 'nonsense', 42]) {
      const state = narrowJobState(payload);
      expect(state.status).toBe('failed');
      expect(state.results).toEqual([]);
      expect(state.failures).toEqual([]);
      expect(state.progress.totalCount).toBe(0);
    }
  });

  it('defaults a failure with no code to unknown, so the UI always has a message', () => {
    const state = narrowJobState({ failures: [{ uri: 'file:///tmp/x' }] });
    expect(state.failures[0]?.code).toBe('unknown');
  });
});
