import {
  BeforeApplicationShutdown,
  DynamicModule,
  Inject,
  Module,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { hostname } from 'node:os';
import { LOGGER_PORT, LoggerPort } from '../application/ports/logger.port';
import { ProcessNextJob } from '../application/use-cases/process-next-job';
import { RecoverStaleJobs } from '../application/use-cases/recover-stale-jobs';
import { APP_CONFIG, AppConfig } from '../infrastructure/config/app-config';
import { terminateAllProcesses } from '../infrastructure/process/run-process';
import { JobWorker } from '../infrastructure/worker/job-worker';
import { ApplicationModule } from './application.module';

const WORKER_ENABLED = Symbol('WorkerEnabled');
const SHUTDOWN_GRACE_MS = 10_000;

/** Starts the worker with the application and stops it (and any child processes) on shutdown. */
class WorkerLifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(
    @Inject(JobWorker) private readonly worker: JobWorker,
    @Inject(WORKER_ENABLED) private readonly enabled: boolean,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.enabled) await this.worker.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (!this.enabled) return;
    await this.worker.stop(SHUTDOWN_GRACE_MS);
    const killed = terminateAllProcesses();
    if (killed > 0) this.logger.warn('Killed child processes on shutdown', { killed });
  }
}

@Module({})
export class WorkerModule {
  /** @param enabled force the worker on/off; by default RUN_WORKER decides. */
  static register(options: { enabled?: boolean } = {}): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ApplicationModule],
      providers: [
        {
          provide: WORKER_ENABLED,
          useFactory: (config: AppConfig) => options.enabled ?? config.RUN_WORKER,
          inject: [APP_CONFIG],
        },
        {
          provide: JobWorker,
          useFactory: (
            config: AppConfig,
            processNextJob: ProcessNextJob,
            recover: RecoverStaleJobs,
            logger: LoggerPort,
          ) =>
            new JobWorker(processNextJob, recover, logger, {
              concurrency: config.WORKER_CONCURRENCY,
              pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
              reaperIntervalMs: Math.max(1000, Math.floor((config.JOB_LEASE_SECONDS * 1000) / 2)),
              workerIdPrefix: `${hostname()}-${process.pid}`,
            }),
          inject: [APP_CONFIG, ProcessNextJob, RecoverStaleJobs, LOGGER_PORT],
        },
        WorkerLifecycle,
      ],
      exports: [JobWorker],
    };
  }
}
