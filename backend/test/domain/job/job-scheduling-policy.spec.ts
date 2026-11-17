import { JobSchedulingPolicy } from '../../../src/domain/job/job-scheduling-policy';
import { at, path, queuedJob } from '../../support/builders';

describe('JobSchedulingPolicy', () => {
  const policy = new JobSchedulingPolicy();

  describe('canRequest', () => {
    it('allows a file without an active job', () => {
      const finished = queuedJob({ file: 'src/a.ts' });
      finished.fail('x', at(1));
      expect(policy.canRequest(path('src/a.ts'), [finished]).ok).toBe(true);
      expect(policy.canRequest(path('src/a.ts'), [queuedJob({ file: 'src/b.ts' })]).ok).toBe(true);
    });

    it('rejects a duplicate active job for the same file', () => {
      const result = policy.canRequest(path('src/a.ts'), [queuedJob({ file: 'src/a.ts' })]);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe('CONFLICT');
    });
  });

  describe('pickNext', () => {
    it('picks the oldest queued job', () => {
      const newer = queuedJob({ id: 'b', now: at(2) });
      const older = queuedJob({ id: 'a', repositoryId: 'repo-2', now: at(1) });
      expect(policy.pickNext([newer, older], [])?.id).toBe('a');
    });

    it('skips repositories that already have a running job', () => {
      const running = queuedJob({ id: 'r', repositoryId: 'repo-1', file: 'src/x.ts' });
      running.start('w', at(1));
      const blocked = queuedJob({ id: 'a', repositoryId: 'repo-1', now: at(1) });
      const free = queuedJob({ id: 'b', repositoryId: 'repo-2', now: at(2) });
      expect(policy.pickNext([blocked, free], [running])?.id).toBe('b');
      expect(policy.pickNext([blocked], [running])).toBeNull();
    });

    it('breaks ties by id and ignores non-queued jobs', () => {
      const b = queuedJob({ id: 'b', repositoryId: 'r2' });
      const a = queuedJob({ id: 'a', repositoryId: 'r1' });
      expect(policy.pickNext([b, a], [])?.id).toBe('a');
      a.fail('x', at(1));
      expect(policy.canStart(a, [])).toBe(false);
    });
  });
});
