import { Repository } from '../../src/domain/repository/repository';
import { repoUrl } from '../support/builders';
import { createHarness, LEASE_MS } from '../support/harness';

describe('RecoverStaleJobs', () => {
  it('requeues a job whose worker crashed, and another worker then completes it', async () => {
    const h = createHarness();
    await h.seedRepository();
    const jobId = await h.queue();

    // Worker 1 claims the job and "crashes": no heartbeat, no further progress.
    const claimed = await h.jobs.claimNext('worker-1', LEASE_MS);
    expect(claimed?.id).toBe(jobId);
    expect(await h.recoverStaleJobs.execute()).toEqual({ requeued: [], failed: [], failedScans: [] });

    h.clock.advance(LEASE_MS + 1);
    const report = await h.recoverStaleJobs.execute();
    expect(report.requeued).toEqual([jobId]);
    expect((await h.jobs.findById(jobId))?.status).toBe('queued');

    const outcome = await h.processNextJob.execute('worker-2');
    expect(outcome.kind).toBe('completed');
    const job = await h.jobs.findById(jobId);
    expect(job?.attempts).toBe(2);
    expect(job?.timeline.map((e) => e.event)).toContain('requeued');
  });

  it('fails a job that keeps crashing workers once attempts are exhausted', async () => {
    const h = createHarness();
    await h.seedRepository();
    const jobId = await h.queue();

    for (let attempt = 1; attempt <= 2; attempt++) {
      await h.jobs.claimNext(`worker-${attempt}`, LEASE_MS);
      h.clock.advance(LEASE_MS + 1);
      await h.recoverStaleJobs.execute();
    }
    const job = await h.jobs.findById(jobId);
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('lease expired 2 time(s)');
  });

  it('keeps jobs whose lease is renewed by a heartbeat', async () => {
    const h = createHarness();
    await h.seedRepository();
    const jobId = await h.queue();
    await h.jobs.claimNext('worker-1', LEASE_MS);
    h.clock.advance(LEASE_MS - 1);
    expect(await h.jobs.extendLease(jobId, 'worker-1', LEASE_MS)).toBe(true);
    expect(await h.jobs.extendLease(jobId, 'someone-else', LEASE_MS)).toBe(false);
    h.clock.advance(LEASE_MS - 1);
    expect((await h.recoverStaleJobs.execute()).requeued).toEqual([]);
  });

  it('marks stale scans as failed', async () => {
    const h = createHarness();
    const repository = Repository.register({ id: 'repo-9', url: repoUrl(), now: h.clock.now() });
    repository.startScan(h.clock.now());
    await h.repositories.save(repository);

    h.clock.advance(30 * 60_000 + 1);
    const report = await h.recoverStaleJobs.execute();
    expect(report.failedScans).toEqual(['repo-9']);
    expect((await h.repositories.findById('repo-9'))?.scanStatus).toBe('failed');
  });

  it('skips a job that another reaper already handled', async () => {
    const h = createHarness();
    await h.seedRepository();
    await h.queue();
    await h.jobs.claimNext('worker-1', LEASE_MS);
    h.clock.advance(LEASE_MS + 1);
    const [a, b] = await Promise.all([h.recoverStaleJobs.execute(), h.recoverStaleJobs.execute()]);
    expect(a.requeued.length + b.requeued.length).toBe(1);
    expect(h.logger.entries.filter((e) => e.level === 'error')).toEqual([]);
  });
});
