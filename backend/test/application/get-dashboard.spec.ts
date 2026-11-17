import { Repository } from '../../src/domain/repository/repository';
import { GetDashboard } from '../../src/application/use-cases/get-dashboard';
import { repoUrl } from '../support/builders';
import { createHarness } from '../support/harness';

describe('GetDashboard', () => {
  const setup = async () => {
    const h = createHarness();
    await h.seedRepository();
    const dashboard = new GetDashboard(h.repositories, h.jobs, h.threshold);
    return { ...h, dashboard };
  };

  it('lists repositories with a snapshot summary', async () => {
    const { dashboard } = await setup();
    const [repo] = await dashboard.listRepositories();
    expect(repo.latestSnapshot).toEqual({
      commitSha: 'a'.repeat(40),
      takenAt: expect.any(String),
      fileCount: 4,
      filesBelowThreshold: 2,
      filesSkipped: 1,
      averageLineCoverage: 31.25,
    });
  });

  it('lists all files by path, or files below the threshold lowest first, with their latest job', async () => {
    const h = await setup();
    const jobId = await h.queue('src/cache.ts');

    const all = await h.dashboard.listFiles('repo-1', { belowThresholdOnly: false });
    expect(all.ok && all.value.map((f) => [f.path, f.belowThreshold, f.kind, f.skippedReason])).toEqual([
      ['src/cache.ts', true, 'module', null],
      ['src/index.ts', true, 're-export-only', 're-exports only'],
      ['src/ok.ts', false, 'module', null],
      ['src/price.ts', true, 'module', null],
    ]);

    // Candidates lowest first, then the skipped files so the UI can explain why they are not offered.
    const below = await h.dashboard.listFiles('repo-1', { belowThresholdOnly: true });
    expect(below.ok && below.value.map((f) => [f.path, f.skippedReason])).toEqual([
      ['src/price.ts', null],
      ['src/cache.ts', null],
      ['src/index.ts', 're-exports only'],
    ]);
    expect(below.ok && below.value[1].latestJob?.id).toBe(jobId);
    expect(below.ok && below.value[0].latestJob).toBeNull();
  });

  it('returns jobs and single records', async () => {
    const h = await setup();
    const jobId = await h.queue('src/price.ts');
    const jobs = await h.dashboard.listJobs('repo-1');
    expect(jobs.ok && jobs.value.map((j) => j.id)).toEqual([jobId]);
    const job = await h.dashboard.getJob(jobId);
    expect(job.ok && job.value.timeline[0]).toEqual({ event: 'queued', at: expect.any(String), note: null });
    const repo = await h.dashboard.getRepository('repo-1');
    expect(repo.ok && repo.value.id).toBe('repo-1');
  });

  it('returns NOT_FOUND for unknown ids and no files before a scan', async () => {
    const h = await setup();
    for (const result of [
      await h.dashboard.getRepository('x'),
      await h.dashboard.listFiles('x', { belowThresholdOnly: false }),
      await h.dashboard.listJobs('x'),
      await h.dashboard.getJob('x'),
    ]) {
      expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    }
    await h.repositories.save(Repository.register({ id: 'fresh', url: repoUrl(), now: h.clock.now() }));
    const files = await h.dashboard.listFiles('fresh', { belowThresholdOnly: true });
    expect(files.ok && files.value).toEqual([]);
  });
});
