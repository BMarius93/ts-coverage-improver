import { ProcessOutcome } from '../../../src/application/use-cases/process-next-job';
import { RecoveryReport } from '../../../src/application/use-cases/recover-stale-jobs';
import { JobWorker } from '../../../src/infrastructure/worker/job-worker';
import { RecordingLogger } from '../../support/fakes';

const emptyReport: RecoveryReport = { requeued: [], failed: [], failedScans: [] };
const options = { concurrency: 2, pollIntervalMs: 20, reaperIntervalMs: 50, workerIdPrefix: 'host-1' };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('JobWorker', () => {
  it('reaps on start, then runs one loop per slot with distinct worker ids', async () => {
    const order: string[] = [];
    const recovery = { execute: jest.fn(async () => (order.push('reap'), emptyReport)) };
    const processor = {
      execute: jest.fn(async (workerId: string): Promise<ProcessOutcome> => {
        order.push(`process:${workerId}`);
        return { kind: 'idle' };
      }),
    };
    const worker = new JobWorker(processor, recovery, new RecordingLogger(), options);
    await worker.start();
    expect(worker.running).toBe(true);
    await wait(30);
    await worker.stop(1000);

    expect(order[0]).toBe('reap');
    const workerIds = new Set(processor.execute.mock.calls.map(([id]) => id));
    expect(workerIds).toEqual(new Set(['host-1-1', 'host-1-2']));
    expect(worker.running).toBe(false);
  });

  it('keeps processing without sleeping while there is work', async () => {
    let remaining = 5;
    const processor = {
      execute: jest.fn(async (): Promise<ProcessOutcome> =>
        remaining-- > 0 ? { kind: 'completed', jobId: 'j', prUrl: 'u' } : { kind: 'idle' },
      ),
    };
    const worker = new JobWorker(processor, { execute: async () => emptyReport }, new RecordingLogger(), {
      ...options,
      concurrency: 1,
      pollIntervalMs: 10_000,
    });
    await worker.start();
    await wait(30);
    expect(processor.execute).toHaveBeenCalledTimes(6);
    await worker.stop(1000); // wakes the sleeping slot immediately
  });

  it('survives errors from the processor and the reaper', async () => {
    const logger = new RecordingLogger();
    const processor = {
      execute: jest.fn(async (): Promise<ProcessOutcome> => Promise.reject(new Error('db down'))),
    };
    const recovery = { execute: jest.fn(async () => Promise.reject(new Error('reaper down'))) };
    const worker = new JobWorker(processor, recovery, logger, options);
    await worker.start();
    await wait(80);
    await worker.stop(1000);
    expect(processor.execute.mock.calls.length).toBeGreaterThan(2);
    expect(recovery.execute.mock.calls.length).toBeGreaterThanOrEqual(2); // on start + interval
    expect(logger.entries.filter((e) => e.message === 'Worker iteration failed').length).toBeGreaterThan(0);
    expect(logger.entries.some((e) => e.message === 'Reaper failed')).toBe(true);
  });

  it('waits for in-flight jobs on stop, up to the grace period', async () => {
    let release: () => void = () => undefined;
    const processor = {
      execute: jest.fn(
        () =>
          new Promise<ProcessOutcome>((resolve) => {
            release = () => resolve({ kind: 'completed', jobId: 'j', prUrl: 'u' });
          }),
      ),
    };
    const logger = new RecordingLogger();
    const worker = new JobWorker(processor, { execute: async () => emptyReport }, logger, {
      ...options,
      concurrency: 1,
    });
    await worker.start();
    await wait(5);
    await worker.stop(50); // job never finishes within the grace period
    expect(logger.entries.at(-1)).toMatchObject({
      message: 'Worker stopped',
      context: { outcome: 'timeout' },
    });

    release();
    await worker.start();
    await wait(5);
    release();
    await worker.stop(1000);
    expect(logger.entries.at(-1)).toMatchObject({
      message: 'Worker stopped',
      context: { outcome: 'drained' },
    });
  });

  it('logs what the reaper recovered and does not start twice', async () => {
    const logger = new RecordingLogger();
    const recovery = { execute: jest.fn(async () => ({ ...emptyReport, requeued: ['job-1'] })) };
    const worker = new JobWorker({ execute: async () => ({ kind: 'idle' }) }, recovery, logger, options);
    await worker.start();
    await worker.start();
    await worker.stop(1000);
    expect(recovery.execute).toHaveBeenCalledTimes(1);
    expect(logger.entries.some((e) => e.message === 'Reaper recovered stale work')).toBe(true);
  });
});
