import { PullRequestUrl } from '../../../src/domain/job/pull-request-url';
import { Repository } from '../../../src/domain/repository/repository';
import { ConcurrencyConflictError, ConflictError } from '../../../src/domain/shared/domain-error';
import { unwrap } from '../../../src/domain/shared/result';
import { SqliteDatabase } from '../../../src/infrastructure/persistence/sqlite/sqlite-database';
import { SqliteImprovementJobRepository } from '../../../src/infrastructure/persistence/sqlite/sqlite-improvement-job-repository';
import { SqliteJobQueue } from '../../../src/infrastructure/persistence/sqlite/sqlite-job-queue';
import { SqliteRepositoryRepository } from '../../../src/infrastructure/persistence/sqlite/sqlite-repository-repository';
import { at, pct, plan, queuedJob, repoUrl, T0 } from '../../support/builders';
import { FixedClock } from '../../support/fakes';
import { tempDatabase } from '../../support/sqlite';

const LEASE = 60_000;

describe('SQLite job persistence', () => {
  let db: SqliteDatabase;
  let cleanup: () => void;
  let jobs: SqliteImprovementJobRepository;
  let queue: SqliteJobQueue;
  let clock: FixedClock;

  beforeEach(async () => {
    ({ db, cleanup } = tempDatabase());
    clock = new FixedClock(at(100));
    jobs = new SqliteImprovementJobRepository(db);
    queue = new SqliteJobQueue(db, clock);
    const repositories = new SqliteRepositoryRepository(db);
    for (const id of ['repo-1', 'repo-2']) {
      await repositories.save(
        Repository.register({ id, url: repoUrl(`https://github.com/acme/${id}`), now: T0 }),
      );
    }
  });
  afterEach(() => cleanup());

  describe('SqliteImprovementJobRepository', () => {
    it('round-trips every field of a completed job', async () => {
      const job = queuedJob();
      await jobs.save(job);
      job.start('worker-1', at(1));
      job.recordCoverageBefore(pct(10), at(2));
      job.advanceTo('planning', at(3));
      job.recordPlan(plan(), at(4));
      for (const phase of ['writing', 'verifying', 'fixing', 'verifying', 'opening_pr'] as const) {
        job.advanceTo(phase, at(5));
      }
      job.complete(unwrap(PullRequestUrl.create('https://github.com/acme/repo-1/pull/3')), pct(91.5), at(9));
      await jobs.save(job);

      const loaded = await jobs.findById(job.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(2);
      expect({
        status: loaded!.status,
        phase: loaded!.phase,
        attempts: loaded!.attempts,
        fixAttempts: loaded!.fixAttempts,
        branch: loaded!.branchName,
        before: loaded!.coverageBefore?.value,
        after: loaded!.coverageAfter?.value,
        plan: loaded!.testPlan?.toProps(),
        pr: loaded!.prUrl?.value,
        startedAt: loaded!.startedAt,
        finishedAt: loaded!.finishedAt,
        timeline: loaded!.timeline,
      }).toEqual({
        status: 'completed',
        phase: null,
        attempts: 1,
        fixAttempts: 1,
        branch: job.branchName,
        before: 10,
        after: 91.5,
        plan: plan().toProps(),
        pr: 'https://github.com/acme/repo-1/pull/3',
        startedAt: at(1),
        finishedAt: at(9),
        timeline: job.timeline,
      });
    });

    it('rejects a stale write (optimistic concurrency)', async () => {
      await jobs.save(queuedJob());
      const a = (await jobs.findById('job-00000001'))!;
      const b = (await jobs.findById('job-00000001'))!;
      a.fail('first', at(1));
      await jobs.save(a);
      b.fail('second', at(2));
      await expect(jobs.save(b)).rejects.toBeInstanceOf(ConcurrencyConflictError);
      expect((await jobs.findById('job-00000001'))?.error).toBe('first');
    });

    it('rejects a second active job for the same file (partial unique index)', async () => {
      await jobs.save(queuedJob({ id: 'a' }));
      await expect(jobs.save(queuedJob({ id: 'b' }))).rejects.toBeInstanceOf(ConflictError);
      const finished = (await jobs.findById('a'))!;
      finished.fail('x', at(1));
      await jobs.save(finished);
      await expect(jobs.save(queuedJob({ id: 'b' }))).resolves.toBeUndefined();
    });

    it('rejects two running jobs for one repository even if application code tried', () => {
      db.prepare(
        `INSERT INTO jobs (id, repository_id, target_file, status, timeline, created_at, updated_at, version)
         VALUES ('x', 'repo-1', 'src/x.ts', 'running', '[]', '', '', 1)`,
      ).run();
      expect(() =>
        db
          .prepare(
            `INSERT INTO jobs (id, repository_id, target_file, status, timeline, created_at, updated_at, version)
             VALUES ('y', 'repo-1', 'src/y.ts', 'running', '[]', '', '', 1)`,
          )
          .run(),
      ).toThrow(/UNIQUE constraint failed: jobs.repository_id/);
    });

    it('lists jobs newest first and active jobs', async () => {
      await jobs.save(queuedJob({ id: 'old', file: 'src/a.ts', now: at(1) }));
      await jobs.save(queuedJob({ id: 'new', file: 'src/b.ts', now: at(2) }));
      const old = (await jobs.findById('old'))!;
      old.fail('x', at(3));
      await jobs.save(old);
      expect((await jobs.findByRepository('repo-1')).map((j) => j.id)).toEqual(['new', 'old']);
      expect((await jobs.findActiveByRepository('repo-1')).map((j) => j.id)).toEqual(['new']);
      expect(await jobs.findById('nope')).toBeNull();
    });
  });

  describe('SqliteJobQueue', () => {
    it('claims the oldest queued job, starts it and sets a lease', async () => {
      await jobs.save(queuedJob({ id: 'second', file: 'src/b.ts', now: at(2) }));
      await jobs.save(queuedJob({ id: 'first', file: 'src/a.ts', now: at(1) }));

      const claimed = await queue.claimNext('worker-1', LEASE);
      expect(claimed?.id).toBe('first');
      expect(claimed?.status).toBe('running');
      expect(claimed?.phase).toBe('cloning');
      expect(claimed?.attempts).toBe(1);
      const row = db.prepare('SELECT worker_id, lease_until, version FROM jobs WHERE id = ?').get('first');
      expect(row).toEqual({ worker_id: 'worker-1', lease_until: at(100).getTime() + LEASE, version: 2 });

      // The returned aggregate is in sync with the stored version and can be saved by the worker.
      claimed!.advanceTo('planning', at(101));
      await jobs.save(claimed!);
      expect(db.prepare('SELECT lease_until FROM jobs WHERE id = ?').get('first')).toEqual({
        lease_until: at(100).getTime() + LEASE,
      });
    });

    it('never runs two jobs of one repository, but runs different repositories in parallel', async () => {
      await jobs.save(queuedJob({ id: 'r1-a', file: 'src/a.ts', now: at(1) }));
      await jobs.save(queuedJob({ id: 'r1-b', file: 'src/b.ts', now: at(2) }));
      await jobs.save(queuedJob({ id: 'r2-a', repositoryId: 'repo-2', file: 'src/a.ts', now: at(3) }));

      const otherConnection = new SqliteJobQueue(db, clock);
      expect((await queue.claimNext('w1', LEASE))?.id).toBe('r1-a');
      expect((await otherConnection.claimNext('w2', LEASE))?.id).toBe('r2-a');
      expect(await queue.claimNext('w3', LEASE)).toBeNull();
    });

    it('returns null on an empty queue', async () => {
      expect(await queue.claimNext('w1', LEASE)).toBeNull();
    });

    it('extends leases only for the owning worker and finds expired leases', async () => {
      await jobs.save(queuedJob({ id: 'j' }));
      await queue.claimNext('w1', LEASE);
      expect(await queue.findExpiredLeases()).toEqual([]);

      clock.advance(LEASE - 1);
      expect(await queue.extendLease('j', 'w1', LEASE)).toBe(true);
      expect(await queue.extendLease('j', 'w2', LEASE)).toBe(false);
      clock.advance(LEASE - 1);
      expect(await queue.findExpiredLeases()).toEqual([]);

      clock.advance(2);
      const [expired] = await queue.findExpiredLeases();
      expect(expired.id).toBe('j');
      expired.handleExpiredLease(2, clock.now());
      await jobs.save(expired);
      expect(db.prepare('SELECT status, worker_id, lease_until FROM jobs').get()).toEqual({
        status: 'queued',
        worker_id: null,
        lease_until: null,
      });
      expect(await queue.extendLease('j', 'w1', LEASE)).toBe(false);
    });
  });
});
