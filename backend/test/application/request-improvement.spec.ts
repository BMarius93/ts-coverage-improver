import { Repository } from '../../src/domain/repository/repository';
import { repoUrl } from '../support/builders';
import { createHarness } from '../support/harness';

describe('RequestImprovement', () => {
  it('queues a job for a file of the latest snapshot', async () => {
    const h = createHarness();
    await h.seedRepository();
    const result = await h.requestImprovement.execute({ repositoryId: 'repo-1', filePath: 'src/price.ts' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      status: 'queued',
      targetFile: 'src/price.ts',
      repositoryId: 'repo-1',
    });
    expect(await h.jobs.findById(result.value.id)).not.toBeNull();
  });

  it.each([
    ['../etc/passwd.ts', 'VALIDATION_ERROR'],
    ['src/price.test.ts', 'VALIDATION_ERROR'],
    ['src/missing.ts', 'NOT_FOUND'],
  ])('rejects %p with %s', async (filePath, code) => {
    const h = createHarness();
    await h.seedRepository();
    const result = await h.requestImprovement.execute({ repositoryId: 'repo-1', filePath });
    expect(!result.ok && result.error.code).toBe(code);
  });

  it('rejects a re-export-only file with a domain error', async () => {
    const h = createHarness();
    await h.seedRepository();
    const result = await h.requestImprovement.execute({ repositoryId: 'repo-1', filePath: 'src/index.ts' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_AN_IMPROVEMENT_CANDIDATE');
      expect(result.error.message).toContain('re-exports only');
    }
    expect(await h.jobs.findActiveByRepository('repo-1')).toEqual([]);
  });

  it('rejects unknown repositories', async () => {
    const h = createHarness();
    const result = await h.requestImprovement.execute({ repositoryId: 'nope', filePath: 'src/price.ts' });
    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
  });

  it('requires a scan first', async () => {
    const h = createHarness();
    await h.repositories.save(Repository.register({ id: 'repo-2', url: repoUrl(), now: h.clock.now() }));
    const result = await h.requestImprovement.execute({ repositoryId: 'repo-2', filePath: 'src/price.ts' });
    expect(!result.ok && result.error.code).toBe('CONFLICT');
  });

  it('rejects a duplicate active job but allows a new one after the first finished', async () => {
    const h = createHarness();
    await h.seedRepository();
    await h.queue('src/price.ts');
    const duplicate = await h.requestImprovement.execute({
      repositoryId: 'repo-1',
      filePath: 'src/price.ts',
    });
    expect(!duplicate.ok && duplicate.error.code).toBe('CONFLICT');

    h.ai.failOn.plan = new Error('AI unavailable');
    await h.processNextJob.execute('worker-1');
    const retry = await h.requestImprovement.execute({ repositoryId: 'repo-1', filePath: 'src/price.ts' });
    expect(retry.ok).toBe(true);
  });
});
