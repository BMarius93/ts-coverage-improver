import { ImprovementJob } from './improvement-job';

/**
 * Persistence contract for the ImprovementJob aggregate. `save` must apply optimistic concurrency:
 * if the stored version differs from `job.version` it throws ConcurrencyConflictError, otherwise it
 * stores the job and calls `job.markSaved()`.
 */
export interface ImprovementJobRepository {
  save(job: ImprovementJob): Promise<void>;
  findById(id: string): Promise<ImprovementJob | null>;
  /** Newest first. */
  findByRepository(repositoryId: string): Promise<ImprovementJob[]>;
  findActiveByRepository(repositoryId: string): Promise<ImprovementJob[]>;
}
