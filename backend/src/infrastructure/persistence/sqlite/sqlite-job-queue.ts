import { JobQueuePort } from '../../../application/ports/job-queue.port';
import { ImprovementJob } from '../../../domain/job/improvement-job';
import { Clock } from '../../../domain/shared/clock';
import { JobRow, toJob } from './job-row';
import { asPromise, SqliteDatabase } from './sqlite-database';
import { SqliteImprovementJobRepository } from './sqlite-improvement-job-repository';

/**
 * Oldest queued job whose repository has no running job (JobSchedulingPolicy, expressed in SQL so the
 * check and the update happen under the same write lock).
 */
const NEXT_CANDIDATE_SQL = `
  SELECT j.* FROM jobs j
  WHERE j.status = 'queued'
    AND NOT EXISTS (SELECT 1 FROM jobs r WHERE r.repository_id = j.repository_id AND r.status = 'running')
  ORDER BY j.created_at, j.id
  LIMIT 1`;

/**
 * Job queue on SQLite. The claim runs inside `BEGIN IMMEDIATE`, which takes the database write lock up
 * front: two workers (threads or processes) can never select the same candidate, and the partial unique
 * index `one_running_job_per_repo` rejects anything that slips past application logic.
 */
export class SqliteJobQueue implements JobQueuePort {
  private readonly jobs: SqliteImprovementJobRepository;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: Clock,
  ) {
    this.jobs = new SqliteImprovementJobRepository(db);
  }

  claimNext(workerId: string, leaseMs: number): Promise<ImprovementJob | null> {
    const claim = this.db.transaction((): ImprovementJob | null => {
      const row = this.db.prepare<[], JobRow>(NEXT_CANDIDATE_SQL).get();
      if (!row) {
        return null;
      }
      const now = this.clock.now();
      const job = toJob(row);
      job.start(workerId, now);
      this.jobs.saveSync(job);
      this.db.prepare('UPDATE jobs SET lease_until = ? WHERE id = ?').run(now.getTime() + leaseMs, job.id);
      return job;
    });
    return asPromise(() => claim.immediate());
  }

  extendLease(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    return asPromise(() => {
      const { changes } = this.db
        .prepare(`UPDATE jobs SET lease_until = ? WHERE id = ? AND worker_id = ? AND status = 'running'`)
        .run(this.clock.now().getTime() + leaseMs, jobId, workerId);
      return changes === 1;
    });
  }

  findExpiredLeases(): Promise<ImprovementJob[]> {
    return asPromise(() =>
      this.db
        .prepare<[number], JobRow>(
          `SELECT * FROM jobs WHERE status = 'running' AND lease_until < ? ORDER BY lease_until`,
        )
        .all(this.clock.now().getTime())
        .map(toJob),
    );
  }
}
