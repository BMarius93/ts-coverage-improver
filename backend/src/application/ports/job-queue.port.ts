import { ImprovementJob } from '../../domain/job/improvement-job';

/**
 * Queue mechanics on top of job persistence: atomic claim and leases.
 * A claimed job is `running` and owned by `workerId` until its lease expires.
 */
export interface JobQueuePort {
  /** Atomically picks the oldest startable queued job, starts it and leases it. */
  claimNext(workerId: string, leaseMs: number): Promise<ImprovementJob | null>;
  /** Extends the lease; false if the worker no longer owns the running job. */
  extendLease(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  findExpiredLeases(): Promise<ImprovementJob[]>;
}

export const JOB_QUEUE_PORT = Symbol('JobQueuePort');
