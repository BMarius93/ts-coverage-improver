import { ImprovementJobRepository } from '../../domain/job/improvement-job-repository';
import { RepositoryRepository } from '../../domain/repository/repository-repository';
import { Clock } from '../../domain/shared/clock';
import { ConcurrencyConflictError } from '../../domain/shared/domain-error';
import { errorMessage } from '../errors';
import { JobQueuePort } from '../ports/job-queue.port';
import { LoggerPort } from '../ports/logger.port';

export interface RecoverStaleJobsOptions {
  maxAttempts: number;
  /** A scan running longer than this is assumed dead (its process crashed). */
  maxScanDurationMs: number;
}

export interface RecoveryReport {
  requeued: string[];
  failed: string[];
  failedScans: string[];
}

/**
 * The reaper. Jobs whose lease expired (worker crashed or hung) are requeued, or failed once they have
 * used up JOB_MAX_ATTEMPTS. Stale scans are marked failed. Runs on startup and on an interval; safe to
 * run concurrently from several processes thanks to optimistic concurrency.
 */
export class RecoverStaleJobs {
  constructor(
    private readonly queue: JobQueuePort,
    private readonly jobs: ImprovementJobRepository,
    private readonly repositories: RepositoryRepository,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
    private readonly options: RecoverStaleJobsOptions,
  ) {}

  async execute(): Promise<RecoveryReport> {
    const report: RecoveryReport = { requeued: [], failed: [], failedScans: [] };

    for (const job of await this.queue.findExpiredLeases()) {
      try {
        const outcome = job.handleExpiredLease(this.options.maxAttempts, this.clock.now());
        await this.jobs.save(job);
        (outcome === 'requeued' ? report.requeued : report.failed).push(job.id);
        this.logger.warn(`Expired job lease: ${outcome}`, { jobId: job.id, attempts: job.attempts });
      } catch (error) {
        if (!(error instanceof ConcurrencyConflictError)) {
          this.logger.error('Could not recover job', { jobId: job.id, error: errorMessage(error) });
        }
      }
    }

    const now = this.clock.now();
    for (const repository of await this.repositories.findAll()) {
      if (repository.isScanStale(now, this.options.maxScanDurationMs)) {
        repository.failScan('Scan was interrupted (timed out or the server restarted)', now);
        await this.repositories.save(repository);
        report.failedScans.push(repository.id);
      }
    }
    return report;
  }
}
