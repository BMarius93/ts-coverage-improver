import { HARDENING_PATHS } from '../../src/application/use-cases/process-next-job';
import { JobPhase } from '../../src/domain/job/job-status';
import { plan } from '../support/builders';
import { measurement } from '../support/fakes';
import { createHarness, Harness, LEASE_MS } from '../support/harness';

async function setup(
  options: Parameters<typeof createHarness>[0] = {},
): Promise<Harness & { jobId: string }> {
  const h = createHarness(options);
  await h.seedRepository();
  const jobId = await h.queue('src/price.ts');
  return { ...h, jobId };
}

describe('ProcessNextJob', () => {
  it('returns idle when nothing is queued', async () => {
    const h = createHarness();
    expect(await h.processNextJob.execute('worker-1')).toEqual({ kind: 'idle' });
  });

  describe('happy path (plan-and-write)', () => {
    it('runs every phase, opens a PR and completes the job', async () => {
      const h = await setup();
      const outcome = await h.processNextJob.execute('worker-1');

      expect(outcome).toEqual({
        kind: 'completed',
        jobId: h.jobId,
        prUrl: 'https://github.com/acme/widgets/pull/1',
      });
      const job = await h.jobs.findById(h.jobId);
      expect(job?.status).toBe('completed');
      expect(job?.coverageBefore?.value).toBe(10);
      expect(job?.coverageAfter?.value).toBe(85);
      expect(job?.testPlan?.summary).toBe('Cover discount branches');
      expect(job?.timeline.map((e) => e.event)).toEqual([
        'queued',
        'running',
        'cloning',
        'planning',
        'writing',
        'verifying',
        'opening_pr',
        'completed',
      ]);
      expect(h.ai.calls).toEqual(['plan', 'write']);
    });

    it('works on a dedicated branch and commits only the test files', async () => {
      const h = await setup();
      h.git.changes = [
        { path: 'src/price.test.ts', kind: 'added' },
        { path: 'CLAUDE.md', kind: 'deleted' },
      ];
      await h.processNextJob.execute('worker-1');

      const branch = 'coverage/src-price-job00000';
      expect(h.git.calls).toContain(`branch:${branch}`);
      expect(h.git.commits).toEqual([
        { files: ['src/price.test.ts'], message: expect.stringContaining('src/price.ts') },
      ]);
      expect(h.git.pushes).toEqual([branch]);
      expect(h.pullRequests.opened[0]).toMatchObject({ head: branch, base: 'main' });
      expect(h.pullRequests.opened[0].title).toBe('test: improve coverage of src/price.ts (10.00% → 85.00%)');
      expect(h.pullRequests.opened[0].body).toContain('| 10.00% | 85.00% | +75.00 pp |');
      expect(h.pullRequests.opened[0].body).toContain('applies a percentage discount');
    });

    it('removes AI steering files before the AI runs and cleans up afterwards', async () => {
      const h = await setup();
      const removePaths = jest.spyOn(h.workspace, 'removePaths');
      await h.processNextJob.execute('worker-1');
      expect(removePaths).toHaveBeenCalledWith(expect.any(String), HARDENING_PATHS);
      expect(h.workspace.removed).toEqual(h.workspace.created);
      expect(h.leaseKeeper.started).toEqual([h.jobId]);
      expect(h.leaseKeeper.stopped).toBe(1);
    });

    it('uses the planned test file as the writer target', async () => {
      const h = await setup();
      h.ai.testPlan = plan('src/__tests__/price.test.ts');
      const write = jest.spyOn(h.ai, 'write');
      await h.processNextJob.execute('worker-1');
      expect(write.mock.calls[0][0].suggestedTestFile.value).toBe('src/__tests__/price.test.ts');
    });

    it('treats a file without any coverage data as 0% before', async () => {
      const h = await setup();
      h.coverage.fileMeasurements = [measurement(null), measurement(40)];
      await h.processNextJob.execute('worker-1');
      expect((await h.jobs.findById(h.jobId))?.coverageBefore?.value).toBe(0);
    });
  });

  it('skips planning in single AI mode', async () => {
    const h = await setup({ aiMode: 'single' });
    const outcome = await h.processNextJob.execute('worker-1');
    expect(outcome.kind).toBe('completed');
    expect(h.ai.calls).toEqual(['planAndWrite']);
    const job = await h.jobs.findById(h.jobId);
    expect(job?.timeline.map((e) => e.event)).not.toContain('planning');
    expect(job?.testPlan).not.toBeNull();
  });

  describe('fix loop', () => {
    it('asks the AI to fix failing tests and then succeeds', async () => {
      const h = await setup();
      h.coverage.fileMeasurements = [measurement(10), measurement(50, false), measurement(80)];
      const outcome = await h.processNextJob.execute('worker-1');

      expect(outcome.kind).toBe('completed');
      expect(h.ai.calls).toEqual(['plan', 'write', 'fix']);
      expect(h.ai.fixRequests[0]).toEqual({
        failures: ['Tests are failing.'],
        output: 'FAIL: expected 1 to be 2',
      });
      const job = await h.jobs.findById(h.jobId);
      expect(job?.fixAttempts).toBe(1);
      expect(job?.coverageAfter?.value).toBe(80);
    });

    it('fails after AI_MAX_FIX_ATTEMPTS unsuccessful fixes', async () => {
      const h = await setup({ maxFixAttempts: 2, keepFailedWorkspaces: true });
      h.coverage.fileMeasurements = [measurement(10), measurement(10)];
      const outcome = await h.processNextJob.execute('worker-1');

      expect(outcome.kind).toBe('failed');
      expect(h.ai.calls).toEqual(['plan', 'write', 'fix', 'fix']);
      const job = await h.jobs.findById(h.jobId);
      expect(job?.status).toBe('failed');
      expect(job?.phase).toBe('verifying');
      expect(job?.error).toMatch(/Verification failed after 2 fix attempt\(s\): Coverage did not increase/);
      expect(h.git.pushes).toHaveLength(0);
      expect(h.pullRequests.opened).toHaveLength(0);
      expect(h.workspace.removed).toHaveLength(0); // kept for inspection
    });

    it('rejects changes to non-test files even when coverage rose', async () => {
      const h = await setup({ maxFixAttempts: 0 });
      h.git.changes = [
        { path: 'src/price.test.ts', kind: 'added' },
        { path: 'src/price.ts', kind: 'modified' },
      ];
      const outcome = await h.processNextJob.execute('worker-1');
      expect(outcome.kind === 'failed' && outcome.error).toContain('src/price.ts was modified');
      expect(h.workspace.removed).toHaveLength(1);
    });
  });

  describe('failure at every phase', () => {
    const cases: Array<[string, JobPhase, (h: Harness) => void]> = [
      ['clone fails', 'cloning', (h) => (h.git.failOn.clone = new Error('clone failed'))],
      [
        'npm ci fails',
        'cloning',
        (h) => (h.coverage.failOn.installDependencies = new Error('npm ci failed')),
      ],
      ['planner fails', 'planning', (h) => (h.ai.failOn.plan = new Error('planner returned invalid JSON'))],
      ['writer fails', 'writing', (h) => (h.ai.failOn.write = new Error('writer timed out'))],
      ['git status fails', 'verifying', (h) => (h.git.failOn.changedFiles = new Error('git status failed'))],
      [
        'fixer fails',
        'fixing',
        (h) => {
          h.coverage.fileMeasurements = [measurement(10), measurement(10)];
          h.ai.failOn.fix = new Error('fixer crashed');
        },
      ],
      ['push fails', 'opening_pr', (h) => (h.git.failOn.push = new Error('push rejected'))],
      ['PR creation fails', 'opening_pr', (h) => (h.pullRequests.failure = new Error('GitHub 422'))],
    ];

    it.each(cases)('%s -> job failed in phase %s', async (_label, phase, breakIt) => {
      const h = await setup();
      breakIt(h);
      const outcome = await h.processNextJob.execute('worker-1');

      expect(outcome.kind).toBe('failed');
      const job = await h.jobs.findById(h.jobId);
      expect(job?.status).toBe('failed');
      expect(job?.phase).toBe(phase);
      expect(job?.error).toBeTruthy();
      expect(h.leaseKeeper.stopped).toBe(1);
      expect(h.workspace.removed).toHaveLength(1);
    });

    it('fails when the repository was deleted', async () => {
      const h = await setup();
      jest.spyOn(h.repositories, 'findById').mockResolvedValueOnce(null);
      const outcome = await h.processNextJob.execute('worker-1');
      expect(outcome.kind === 'failed' && outcome.error).toBe('Repository repo-1 not found');
      expect(h.workspace.created).toHaveLength(0);
    });
  });

  describe('lease loss', () => {
    it('abandons the job without touching it when the heartbeat lost the lease', async () => {
      const h = await setup();
      h.ai.onCall = (method) => {
        if (method === 'write') h.leaseKeeper.lost = true;
      };
      const outcome = await h.processNextJob.execute('worker-1');

      expect(outcome.kind).toBe('abandoned');
      const job = await h.jobs.findById(h.jobId);
      expect(job?.status).toBe('running');
      expect(job?.phase).toBe('writing'); // persisted before the AI call; 'verifying' was refused
      expect(h.pullRequests.opened).toHaveLength(0);
    });

    it('abandons when the reaper requeued the job meanwhile (optimistic concurrency)', async () => {
      const h = await setup();
      h.ai.onCall = (method) => {
        if (method === 'plan') {
          h.clock.advance(LEASE_MS + 1);
          void h.recoverStaleJobs.execute();
        }
      };
      const outcome = await h.processNextJob.execute('worker-1');
      expect(outcome.kind).toBe('abandoned');
      const job = await h.jobs.findById(h.jobId);
      expect(job?.status).toBe('queued');
      expect(job?.timeline.at(-1)?.event).toBe('requeued');
    });

    it('reports abandoned when even recording the failure is rejected', async () => {
      const h = await setup();
      h.ai.onCall = (method) => {
        if (method === 'write') {
          h.clock.advance(LEASE_MS + 1);
          void h.recoverStaleJobs.execute();
          throw new Error('writer failed');
        }
      };
      const outcome = await h.processNextJob.execute('worker-1');
      expect(outcome.kind).toBe('abandoned');
      expect(h.logger.entries.some((e) => e.message === 'Could not record job failure')).toBe(true);
    });
  });

  describe('scheduling', () => {
    it('runs one job per repository at a time, but different repositories in parallel', async () => {
      const h = createHarness();
      await h.seedRepository('repo-1', 'https://github.com/acme/one');
      await h.seedRepository('repo-2', 'https://github.com/acme/two');
      await h.queue('src/price.ts', 'repo-1');
      await h.queue('src/cache.ts', 'repo-1');
      await h.queue('src/price.ts', 'repo-2');

      const first = await h.jobs.claimNext('w1', LEASE_MS);
      const second = await h.jobs.claimNext('w2', LEASE_MS);
      const third = await h.jobs.claimNext('w3', LEASE_MS);
      expect([first?.repositoryId, second?.repositoryId]).toEqual(['repo-1', 'repo-2']);
      expect(third).toBeNull();
    });
  });
});
