import { IntervalLeaseKeeper } from '../../../src/infrastructure/worker/interval-lease-keeper';
import { RecordingLogger } from '../../support/fakes';

describe('IntervalLeaseKeeper', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const queue = (extend: () => Promise<boolean>) => ({
    claimNext: jest.fn(),
    findExpiredLeases: jest.fn(),
    extendLease: jest.fn(extend),
  });

  it('extends the lease every third of the lease period', async () => {
    const q = queue(async () => true);
    const handle = new IntervalLeaseKeeper(q, 3000, new RecordingLogger()).keepAlive('job-1', 'w1');
    await jest.advanceTimersByTimeAsync(3000);
    expect(q.extendLease).toHaveBeenCalledTimes(3);
    expect(q.extendLease).toHaveBeenCalledWith('job-1', 'w1', 3000);
    expect(handle.isLost()).toBe(false);
    handle.stop();
    await jest.advanceTimersByTimeAsync(3000);
    expect(q.extendLease).toHaveBeenCalledTimes(3);
  });

  it('marks the lease lost when the worker no longer owns the job', async () => {
    const q = queue(async () => false);
    const handle = new IntervalLeaseKeeper(q, 3000, new RecordingLogger()).keepAlive('job-1', 'w1');
    await jest.advanceTimersByTimeAsync(1000);
    expect(handle.isLost()).toBe(true);
    await jest.advanceTimersByTimeAsync(3000);
    expect(q.extendLease).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('tolerates transient heartbeat errors until a whole lease period passed without success', async () => {
    let now = 0;
    const q = queue(async () => {
      throw new Error('database is locked');
    });
    const logger = new RecordingLogger();
    const handle = new IntervalLeaseKeeper(q, 3000, logger, () => now).keepAlive('job-1', 'w1');
    now = 1000;
    await jest.advanceTimersByTimeAsync(1000);
    expect(handle.isLost()).toBe(false);
    now = 3000;
    await jest.advanceTimersByTimeAsync(2000);
    expect(handle.isLost()).toBe(true);
    expect(logger.entries.some((e) => e.message === 'Heartbeat failed')).toBe(true);
    handle.stop();
  });
});
