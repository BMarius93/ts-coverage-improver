import { FilePath } from '../coverage/file-path';
import { ConflictError } from '../shared/domain-error';
import { err, ok, Result } from '../shared/result';
import { ImprovementJob } from './improvement-job';

/**
 * Scheduling rules:
 * - at most one running job per repository (jobs for one repo would otherwise race on branches
 *   and on the same files), while jobs for different repositories may run in parallel;
 * - at most one active (queued or running) job per file, so a user cannot open duplicate PRs.
 *
 * The SQLite adapter enforces the first rule atomically in SQL (plus a partial unique index); this
 * class is the authoritative, framework-free statement of the rules and is used by in-memory adapters.
 */
export class JobSchedulingPolicy {
  canRequest(targetFile: FilePath, activeJobsOfRepository: ImprovementJob[]): Result<void, ConflictError> {
    const duplicate = activeJobsOfRepository.find((job) => job.isActive && job.targetFile.equals(targetFile));
    if (duplicate) {
      return err(
        new ConflictError(`An improvement job for ${targetFile.value} is already ${duplicate.status}`),
      );
    }
    return ok(undefined);
  }

  canStart(job: ImprovementJob, runningJobs: ImprovementJob[]): boolean {
    return (
      job.status === 'queued' &&
      !runningJobs.some(
        (running) => running.status === 'running' && running.repositoryId === job.repositoryId,
      )
    );
  }

  /** Oldest queued job whose repository has no running job, or null. */
  pickNext(queuedJobs: ImprovementJob[], runningJobs: ImprovementJob[]): ImprovementJob | null {
    const candidates = queuedJobs
      .filter((job) => this.canStart(job, runningJobs))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    return candidates[0] ?? null;
  }
}
