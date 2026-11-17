import { ImprovementJob } from '../../../src/domain/job/improvement-job';
import { JOB_PHASES, JobPhase } from '../../../src/domain/job/job-status';
import { PullRequestUrl } from '../../../src/domain/job/pull-request-url';
import { IllegalStateTransitionError, ValidationError } from '../../../src/domain/shared/domain-error';
import { unwrap } from '../../../src/domain/shared/result';
import { at, path, pct, plan, queuedJob, T0 } from '../../support/builders';

const PR = unwrap(PullRequestUrl.create('https://github.com/acme/widgets/pull/7'));

function runningJob(): ImprovementJob {
  const job = queuedJob();
  job.start('worker-1', at(1));
  return job;
}

function jobInPhase(phase: JobPhase): ImprovementJob {
  const routes: Record<JobPhase, JobPhase[]> = {
    cloning: [],
    planning: ['planning'],
    writing: ['planning', 'writing'],
    verifying: ['planning', 'writing', 'verifying'],
    fixing: ['planning', 'writing', 'verifying', 'fixing'],
    opening_pr: ['planning', 'writing', 'verifying', 'opening_pr'],
  };
  const job = runningJob();
  routes[phase].forEach((p, i) => job.advanceTo(p, at(2 + i)));
  return job;
}

describe('ImprovementJob', () => {
  describe('request', () => {
    it('creates a queued job', () => {
      const job = queuedJob();
      expect(job.status).toBe('queued');
      expect(job.phase).toBeNull();
      expect(job.attempts).toBe(0);
      expect(job.version).toBe(0);
      expect(job.isActive).toBe(true);
      expect(job.isFinished).toBe(false);
      expect(job.timeline).toEqual([{ event: 'queued', at: T0 }]);
    });

    it.each(['src/a.test.ts', 'src/types.d.ts'])('refuses to target %p', (file) => {
      expect(() => queuedJob({ file })).toThrow(ValidationError);
    });

    it('requires ids', () => {
      expect(() => queuedJob({ id: '' })).toThrow(ValidationError);
      expect(() => queuedJob({ repositoryId: ' ' })).toThrow(ValidationError);
    });
  });

  describe('start', () => {
    it('moves to running/cloning, counts the attempt and assigns a branch', () => {
      const job = runningJob();
      expect(job.status).toBe('running');
      expect(job.phase).toBe('cloning');
      expect(job.attempts).toBe(1);
      expect(job.workerId).toBe('worker-1');
      expect(job.startedAt).toEqual(at(1));
      expect(job.branchName).toBe('coverage/src-price-job00000');
      expect(job.timeline.map((e) => e.event)).toEqual(['queued', 'running', 'cloning']);
    });

    it('requires a worker id', () => {
      expect(() => queuedJob().start(' ', T0)).toThrow(ValidationError);
    });

    it('cannot start twice', () => {
      expect(() => runningJob().start('worker-2', at(2))).toThrow(IllegalStateTransitionError);
    });
  });

  describe('phases', () => {
    it('follows the plan-and-write happy path', () => {
      const job = runningJob();
      for (const phase of ['planning', 'writing', 'verifying', 'opening_pr'] as const) {
        job.advanceTo(phase, at(5));
        expect(job.phase).toBe(phase);
      }
    });

    it('allows skipping planning (single AI call mode)', () => {
      const job = runningJob();
      job.advanceTo('writing', at(2));
      expect(job.phase).toBe('writing');
    });

    it('loops between verifying and fixing and counts fix attempts', () => {
      const job = jobInPhase('verifying');
      job.advanceTo('fixing', at(10));
      job.advanceTo('verifying', at(11));
      job.advanceTo('fixing', at(12));
      expect(job.fixAttempts).toBe(2);
    });

    const illegal: Array<[JobPhase, JobPhase]> = [
      ['cloning', 'verifying'],
      ['cloning', 'opening_pr'],
      ['planning', 'verifying'],
      ['writing', 'opening_pr'],
      ['writing', 'fixing'],
      ['fixing', 'opening_pr'],
      ['opening_pr', 'writing'],
      ['verifying', 'writing'],
    ];
    it.each(illegal)('rejects %s -> %s', (from, to) => {
      expect(() => jobInPhase(from).advanceTo(to, at(20))).toThrow(IllegalStateTransitionError);
    });

    it.each(JOB_PHASES)('cannot advance a queued job to %s', (phase) => {
      expect(() => queuedJob().advanceTo(phase, at(1))).toThrow(IllegalStateTransitionError);
    });
  });

  describe('plan and coverage', () => {
    it('records the plan during planning or writing only', () => {
      const planning = jobInPhase('planning');
      planning.recordPlan(plan(), at(3));
      expect(planning.testPlan?.summary).toBe('Cover discount branches');

      const writing = jobInPhase('writing');
      writing.recordPlan(plan(), at(3));
      expect(writing.testPlan).not.toBeNull();

      expect(() => runningJob().recordPlan(plan(), at(3))).toThrow(IllegalStateTransitionError);
      expect(() => queuedJob().recordPlan(plan(), at(3))).toThrow(IllegalStateTransitionError);
    });

    it('accumulates reverted files without duplicates, only while running', () => {
      const job = runningJob();
      job.recordRevertedFiles(['src/b.ts'], at(2));
      job.recordRevertedFiles(['src/a.ts', 'src/b.ts'], at(3));
      job.recordRevertedFiles([], at(4));
      expect(job.revertedFiles).toEqual(['src/a.ts', 'src/b.ts']);
      expect(job.updatedAt).toEqual(at(3));
      expect(() => queuedJob().recordRevertedFiles(['x'], at(1))).toThrow(IllegalStateTransitionError);
    });

    it('records coverage only while running', () => {
      const job = runningJob();
      job.recordCoverageBefore(pct(10), at(2));
      job.recordCoverageAfter(pct(20), at(3));
      expect(job.coverageBefore?.value).toBe(10);
      expect(job.coverageAfter?.value).toBe(20);
      expect(() => queuedJob().recordCoverageBefore(pct(1), at(1))).toThrow(IllegalStateTransitionError);
      expect(() => queuedJob().recordCoverageAfter(pct(1), at(1))).toThrow(IllegalStateTransitionError);
    });
  });

  describe('complete', () => {
    it('completes from opening_pr with improved coverage', () => {
      const job = jobInPhase('opening_pr');
      job.recordCoverageBefore(pct(10), at(9));
      job.complete(PR, pct(85), at(10));
      expect(job.status).toBe('completed');
      expect(job.phase).toBeNull();
      expect(job.prUrl?.number).toBe(7);
      expect(job.coverageAfter?.value).toBe(85);
      expect(job.finishedAt).toEqual(at(10));
      expect(job.workerId).toBeNull();
      expect(job.isFinished).toBe(true);
      expect(job.isActive).toBe(false);
    });

    it('refuses to complete without a coverage increase', () => {
      const job = jobInPhase('opening_pr');
      job.recordCoverageBefore(pct(50), at(9));
      expect(() => job.complete(PR, pct(50), at(10))).toThrow(ValidationError);
    });

    it.each(['cloning', 'planning', 'writing', 'verifying', 'fixing'] as const)(
      'cannot complete from phase %s',
      (phase) => {
        expect(() => jobInPhase(phase).complete(PR, pct(90), at(10))).toThrow(IllegalStateTransitionError);
      },
    );

    it('cannot complete a queued job', () => {
      expect(() => queuedJob().complete(PR, pct(90), at(10))).toThrow(IllegalStateTransitionError);
    });
  });

  describe('fail', () => {
    it('fails a running job and keeps the phase it failed in', () => {
      const job = jobInPhase('writing');
      job.fail('  AI timed out  ', at(10));
      expect(job.status).toBe('failed');
      expect(job.phase).toBe('writing');
      expect(job.error).toBe('AI timed out');
      expect(job.timeline.at(-1)).toEqual({ event: 'failed', at: at(10), note: 'during writing' });
    });

    it('fails a queued job', () => {
      const job = queuedJob();
      job.fail('', at(1));
      expect(job.error).toBe('Unknown error');
      expect(job.timeline.at(-1)).toEqual({ event: 'failed', at: at(1) });
    });

    it('truncates very long errors', () => {
      const job = queuedJob();
      job.fail('x'.repeat(10_000), at(1));
      expect(job.error).toHaveLength(4000);
    });

    it('cannot fail a finished job', () => {
      const job = queuedJob();
      job.fail('once', at(1));
      expect(() => job.fail('twice', at(2))).toThrow(IllegalStateTransitionError);
    });
  });

  describe('requeue and lease expiry', () => {
    it('requeues a running job and keeps its attempts', () => {
      const job = jobInPhase('writing');
      job.requeue(at(10), 'test');
      expect(job.status).toBe('queued');
      expect(job.phase).toBeNull();
      expect(job.workerId).toBeNull();
      expect(job.attempts).toBe(1);
      job.start('worker-2', at(11));
      expect(job.attempts).toBe(2);
      expect(job.startedAt).toEqual(at(1));
    });

    it('cannot requeue a job that is not running', () => {
      expect(() => queuedJob().requeue(at(1), 'x')).toThrow(IllegalStateTransitionError);
    });

    it('requeues on lease expiry while attempts remain, then fails', () => {
      const job = runningJob();
      expect(job.handleExpiredLease(2, at(5))).toBe('requeued');
      job.start('worker-2', at(6));
      expect(job.handleExpiredLease(2, at(7))).toBe('failed');
      expect(job.status).toBe('failed');
      expect(job.error).toContain('lease expired 2 time(s)');
    });

    it('cannot expire a job that is not running', () => {
      expect(() => queuedJob().handleExpiredLease(2, at(1))).toThrow(IllegalStateTransitionError);
    });
  });

  it('increments its version when saved and survives reconstitution', () => {
    const job = runningJob();
    job.markSaved();
    const copy = ImprovementJob.reconstitute({
      id: job.id,
      repositoryId: job.repositoryId,
      targetFile: path('src/price.ts'),
      status: job.status,
      phase: job.phase,
      attempts: job.attempts,
      fixAttempts: job.fixAttempts,
      workerId: job.workerId,
      branchName: job.branchName,
      coverageBefore: null,
      coverageAfter: null,
      testPlan: null,
      revertedFiles: [],
      budget: null,
      aiCostUsd: 0,
      prUrl: null,
      error: null,
      timeline: [...job.timeline],
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      version: job.version,
    });
    expect(copy.version).toBe(1);
    expect(copy.timeline).toHaveLength(3);
    copy.advanceTo('planning', at(3));
    expect(copy.phase).toBe('planning');
  });
});
