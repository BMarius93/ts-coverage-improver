import { ImprovementJob } from '../../../domain/job/improvement-job';
import { ImprovementJobRepository } from '../../../domain/job/improvement-job-repository';
import { ConcurrencyConflictError, ConflictError } from '../../../domain/shared/domain-error';
import { JobRow, toJob, toJobColumns } from './job-row';
import { asPromise, isUniqueViolation, SqliteDatabase } from './sqlite-database';

export class SqliteImprovementJobRepository implements ImprovementJobRepository {
  constructor(private readonly db: SqliteDatabase) {}

  save(job: ImprovementJob): Promise<void> {
    return asPromise(() => this.saveSync(job));
  }

  /**
   * Inserts a new job (version 0) or updates an existing one if nobody changed it since it was loaded.
   * Synchronous so the job queue can call it inside its BEGIN IMMEDIATE transaction.
   */
  saveSync(job: ImprovementJob): void {
    const columns = toJobColumns(job);
    try {
      const { changes } =
        job.version === 0
          ? this.db
              .prepare(
                `INSERT INTO jobs (id, repository_id, target_file, status, phase, attempts, fix_attempts, worker_id,
                   lease_until, branch_name, coverage_before, coverage_after, test_plan, reverted_files, pr_url, error, timeline,
                   created_at, updated_at, started_at, finished_at, version)
                 VALUES (@id, @repository_id, @target_file, @status, @phase, @attempts, @fix_attempts, @worker_id,
                   NULL, @branch_name, @coverage_before, @coverage_after, @test_plan, @reverted_files, @pr_url, @error, @timeline,
                   @created_at, @updated_at, @started_at, @finished_at, 1)`,
              )
              .run(columns)
          : this.db
              .prepare(
                `UPDATE jobs SET status = @status, phase = @phase, attempts = @attempts, fix_attempts = @fix_attempts,
                   worker_id = @worker_id,
                   lease_until = CASE WHEN @status = 'running' THEN lease_until ELSE NULL END,
                   branch_name = @branch_name, coverage_before = @coverage_before, coverage_after = @coverage_after,
                   test_plan = @test_plan, reverted_files = @reverted_files, pr_url = @pr_url, error = @error, timeline = @timeline,
                   updated_at = @updated_at, started_at = @started_at, finished_at = @finished_at,
                   version = version + 1
                 WHERE id = @id AND version = @version`,
              )
              .run(columns);
      if (changes !== 1) {
        throw new ConcurrencyConflictError('ImprovementJob', job.id);
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          `Job ${job.id} conflicts with another active job for ${job.targetFile.value} or its repository`,
        );
      }
      throw error;
    }
    job.markSaved();
  }

  findById(id: string): Promise<ImprovementJob | null> {
    return asPromise(() => {
      const row = this.db.prepare<[string], JobRow>('SELECT * FROM jobs WHERE id = ?').get(id);
      return row ? toJob(row) : null;
    });
  }

  findByRepository(repositoryId: string): Promise<ImprovementJob[]> {
    return asPromise(() =>
      this.db
        .prepare<[string], JobRow>(
          'SELECT * FROM jobs WHERE repository_id = ? ORDER BY created_at DESC, id DESC',
        )
        .all(repositoryId)
        .map(toJob),
    );
  }

  findActiveByRepository(repositoryId: string): Promise<ImprovementJob[]> {
    return asPromise(() =>
      this.db
        .prepare<[string], JobRow>(
          `SELECT * FROM jobs WHERE repository_id = ? AND status IN ('queued', 'running') ORDER BY created_at`,
        )
        .all(repositoryId)
        .map(toJob),
    );
  }
}
