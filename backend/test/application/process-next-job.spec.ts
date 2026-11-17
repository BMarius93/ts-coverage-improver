import { HARDENING_PATHS } from '../../src/application/use-cases/process-next-job';
import { JobPhase } from '../../src/domain/job/job-status';
import { plan } from '../support/builders';
import { AiCallFailedError } from '../../src/application/ports/ai-test-generator.port';
import { FakeGit, measurement } from '../support/fakes';
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

    it('gives the AI the uncovered branches, existing tests and a style example from the baseline run', async () => {
      const h = await setup();
      const plan = jest.spyOn(h.ai, 'plan');
      await h.processNextJob.execute('worker-1');
      expect(plan.mock.calls[0][0]).toMatchObject({
        uncoveredLines: [3, 4],
        uncoveredBranches: [{ line: 3, type: 'if', uncoveredPaths: ['else'] }],
        existingTestFiles: ['src/price.test.ts'],
        styleExample: "it('works', () => expect(1).toBe(1));",
      });
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

    it('reverts non-test edits before verifying, records them and still opens the PR', async () => {
      const h = await setup();
      h.git.changes = [
        { path: 'src/price.test.ts', kind: 'added' },
        { path: 'src/price.ts', kind: 'modified' },
        { path: 'src/helper.ts', kind: 'added' },
        { path: 'CLAUDE.md', kind: 'deleted' },
      ];
      const order: string[] = [];
      jest.spyOn(h.git, 'restoreNonTestChanges').mockImplementation(async (dir, keep) => {
        order.push('restore');
        return FakeGit.prototype.restoreNonTestChanges.call(h.git, dir, keep);
      });
      const measure = h.coverage.measureFile.bind(h.coverage);
      jest.spyOn(h.coverage, 'measureFile').mockImplementation(async (dir, target) => {
        order.push('measure');
        return measure(dir, target);
      });

      const outcome = await h.processNextJob.execute('worker-1');

      expect(outcome.kind).toBe('completed');
      expect(order).toEqual(['measure', 'restore', 'measure', 'measure']); // before, restore, 2 verify runs
      const job = await h.jobs.findById(h.jobId);
      expect(job?.revertedFiles).toEqual(['src/helper.ts', 'src/price.ts']);
      expect(h.git.commits[0].files).toEqual(['src/price.test.ts']);
      expect(h.logger.entries.some((e) => e.message === 'Reverted non-test changes made by the AI')).toBe(
        true,
      );
    });

    it('still rejects non-test changes if a restore missed them (last line of defence)', async () => {
      const h = await setup({ maxFixAttempts: 0 });
      jest.spyOn(h.git, 'restoreNonTestChanges').mockResolvedValue([]);
      h.git.changes = [
        { path: 'src/price.test.ts', kind: 'added' },
        { path: 'src/price.ts', kind: 'modified' },
      ];
      const outcome = await h.processNextJob.execute('worker-1');
      expect(outcome.kind === 'failed' && outcome.error).toContain('src/price.ts was modified');
      expect(h.workspace.removed).toHaveLength(1);
    });
  });

  describe('flaky check (VERIFY_RUNS)', () => {
    it('runs the tests twice after a passing verification and accepts identical results', async () => {
      const h = await setup();
      const outcome = await h.processNextJob.execute('worker-1');
      expect(outcome.kind).toBe('completed');
      expect(h.coverage.measureFileCalls).toBe(3); // before + 2 verification runs
    });

    it('sends a run that passes then fails to the fixer with both outputs', async () => {
      const h = await setup();
      h.coverage.fileMeasurements = [
        measurement(10),
        measurement(85),
        measurement(85, false),
        measurement(85),
      ];
      const outcome = await h.processNextJob.execute('worker-1');

      expect(outcome.kind).toBe('completed');
      expect(h.ai.calls).toEqual(['plan', 'write', 'fix']);
      expect(h.ai.fixRequests[0].failures).toEqual(['Tests are not stable across runs.']);
      expect(h.ai.fixRequests[0].output).toContain('--- verification run 1 (passed) ---\nPASS');
      expect(h.ai.fixRequests[0].output).toContain('--- verification run 2 (failed) ---\nFAIL');
      expect(h.logger.entries.some((e) => e.message === 'Flaky verification')).toBe(true);
    });

    it('treats differing coverage between runs as flaky and fails when fixes run out', async () => {
      const h = await setup({ maxFixAttempts: 0 });
      h.coverage.fileMeasurements = [measurement(10), measurement(85), measurement(70)];
      const outcome = await h.processNextJob.execute('worker-1');
      expect(outcome.kind === 'failed' && outcome.error).toContain('Tests are not stable across runs.');
      expect(h.pullRequests.opened).toHaveLength(0);
    });

    it('does not repeat a run that already failed, and runs once with VERIFY_RUNS=1', async () => {
      const failing = await setup({ maxFixAttempts: 0 });
      failing.coverage.fileMeasurements = [measurement(10), measurement(10)];
      await failing.processNextJob.execute('worker-1');
      expect(failing.coverage.measureFileCalls).toBe(2);

      const single = await setup({ verifyRuns: 1 });
      await single.processNextJob.execute('worker-1');
      expect(single.coverage.measureFileCalls).toBe(2);
    });
  });

  describe('per-job AI budget', () => {
    it('passes the remaining budget to each call and records the total cost', async () => {
      const h = await setup({ jobBudgetUsd: 5 });
      h.ai.costs = { plan: 2.5, write: 0.5 };
      await h.processNextJob.execute('worker-1');
      expect(h.ai.limits).toEqual([3, 2.5]); // min(remaining, per-call cap 3)
      const job = await h.jobs.findById(h.jobId);
      expect(job?.status).toBe('completed');
      expect(job?.aiCostUsd).toBe(3);
    });

    it('fails the job when the second call exceeds the budget', async () => {
      const h = await setup({ jobBudgetUsd: 1 });
      h.ai.costs = { plan: 0.6, write: 0.6 }; // write may spend up to 0.4 but overshoots slightly
      const outcome = await h.processNextJob.execute('worker-1');

      expect(outcome.kind === 'failed' && outcome.error).toBe('AI budget exceeded: spent $1.20 of $1.00');
      expect(h.ai.limits).toEqual([1, 0.4]);
      const job = await h.jobs.findById(h.jobId);
      expect(job?.phase).toBe('writing'); // stopped before verifying
      expect(job?.aiCostUsd).toBe(1.2);
      expect(h.pullRequests.opened).toHaveLength(0);
    });

    it('stops the fix loop when a fix round exhausts the budget', async () => {
      const h = await setup({ jobBudgetUsd: 1, maxFixAttempts: 3 });
      h.ai.costs = { plan: 0.3, write: 0.3, fix: 0.5 };
      h.coverage.fileMeasurements = [measurement(10), measurement(10)];
      const outcome = await h.processNextJob.execute('worker-1');
      expect(outcome.kind === 'failed' && outcome.error).toBe('AI budget exceeded: spent $1.10 of $1.00');
      expect(h.ai.calls).toEqual(['plan', 'write', 'fix']);
      expect(h.ai.limits[2]).toBeCloseTo(0.4);
    });

    it('records the cost of a failed AI call', async () => {
      const h = await setup();
      h.ai.failOn.write = new AiCallFailedError('writer failed (error_during_execution)', 0.7);
      h.ai.costs = { plan: 0.2 };
      const outcome = await h.processNextJob.execute('worker-1');
      expect(outcome.kind).toBe('failed');
      expect((await h.jobs.findById(h.jobId))?.aiCostUsd).toBe(0.9);
    });

    it('fails a job whose deadline passed while it was queued, before cloning', async () => {
      const h = await setup({ jobDeadlineMs: 60_000 });
      h.clock.advance(61_000);
      const outcome = await h.processNextJob.execute('worker-1');
      expect(outcome.kind === 'failed' && outcome.error).toMatch(
        /^Job deadline exceeded: the job had to finish by /,
      );
      expect(h.git.calls).toEqual([]);
      expect(h.ai.calls).toEqual([]);
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
