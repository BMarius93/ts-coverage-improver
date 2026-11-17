import { errorMessage } from '../../application/errors';
import { LoggerPort } from '../../application/ports/logger.port';
import { ProcessOutcome } from '../../application/use-cases/process-next-job';
import { RecoveryReport } from '../../application/use-cases/recover-stale-jobs';

export interface JobWorkerOptions {
  concurrency: number;
  pollIntervalMs: number;
  reaperIntervalMs: number;
  workerIdPrefix: string;
}

export interface JobProcessor {
  execute(workerId: string): Promise<ProcessOutcome>;
}

export interface StaleJobRecovery {
  execute(): Promise<RecoveryReport>;
}

/**
 * Polling worker. Runs `concurrency` independent slots; each slot claims and processes one job at a time
 * and sleeps `pollIntervalMs` when the queue is empty. The reaper runs once on start (recovering jobs
 * orphaned by a previous crash) and then on an interval.
 *
 * Concurrency limits across repositories come from the atomic claim, not from this class, so several
 * worker processes can safely run side by side.
 */
export class JobWorker {
  private stopping = false;
  private slots: Promise<void>[] = [];
  private reaperTimer: NodeJS.Timeout | undefined;
  private reaping: Promise<void> | null = null;
  private readonly wakers = new Set<() => void>();

  constructor(
    private readonly processor: JobProcessor,
    private readonly recovery: StaleJobRecovery,
    private readonly logger: LoggerPort,
    private readonly options: JobWorkerOptions,
  ) {}

  get running(): boolean {
    return this.slots.length > 0 && !this.stopping;
  }

  async start(): Promise<void> {
    if (this.slots.length > 0) return;
    this.stopping = false;
    await this.reap();
    this.reaperTimer = setInterval(() => void this.reap(), this.options.reaperIntervalMs);
    this.slots = Array.from({ length: this.options.concurrency }, (_, i) =>
      this.loop(`${this.options.workerIdPrefix}-${i + 1}`),
    );
    this.logger.info('Worker started', { concurrency: this.options.concurrency });
  }

  /**
   * Stops claiming new jobs and waits up to `graceMs` for running jobs. Jobs still running afterwards keep
   * their lease until it expires; the reaper of the next worker requeues them.
   */
  async stop(graceMs: number): Promise<void> {
    this.stopping = true;
    clearInterval(this.reaperTimer);
    this.wakers.forEach((wake) => wake());
    let timer: NodeJS.Timeout | undefined;
    const grace = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), graceMs);
    });
    const outcome = await Promise.race([Promise.all(this.slots).then(() => 'drained' as const), grace]);
    clearTimeout(timer);
    if (this.reaping) await this.reaping;
    this.slots = [];
    this.logger.info('Worker stopped', { outcome });
  }

  private async loop(workerId: string): Promise<void> {
    while (!this.stopping) {
      let outcome: ProcessOutcome;
      try {
        outcome = await this.processor.execute(workerId);
      } catch (error) {
        // ProcessNextJob handles pipeline errors itself; this is e.g. the database being unavailable.
        this.logger.error('Worker iteration failed', { workerId, error: errorMessage(error) });
        outcome = { kind: 'idle' };
      }
      if (outcome.kind === 'idle') {
        await this.sleep(this.options.pollIntervalMs);
      }
    }
  }

  private reap(): Promise<void> {
    if (this.reaping) return this.reaping;
    this.reaping = this.recovery
      .execute()
      .then((report) => {
        if (report.requeued.length + report.failed.length + report.failedScans.length > 0) {
          this.logger.warn('Reaper recovered stale work', { ...report });
        }
      })
      .catch((error: unknown) => this.logger.error('Reaper failed', { error: errorMessage(error) }))
      .finally(() => {
        this.reaping = null;
      });
    return this.reaping;
  }

  private sleep(ms: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.wakers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.wakers.add(wake);
    });
  }
}
