import { JobBudget } from '../../../src/domain/job/job-budget';
import { ImprovementJob } from '../../../src/domain/job/improvement-job';
import { IllegalStateTransitionError, ValidationError } from '../../../src/domain/shared/domain-error';
import { unwrap } from '../../../src/domain/shared/result';
import { at, path, T0 } from '../../support/builders';

const budget = (maxCostUsd = 5, deadlineSeconds = 600) =>
  unwrap(JobBudget.create({ maxCostUsd, deadline: at(deadlineSeconds) }));

const runningJob = (b: JobBudget | null = budget()) => {
  const job = ImprovementJob.request({
    id: 'job-1',
    repositoryId: 'r',
    targetFile: path('src/a.ts'),
    now: T0,
    budget: b,
  });
  job.start('w', at(1));
  return job;
};

describe('JobBudget', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects a max cost of %p', (maxCostUsd) => {
    expect(JobBudget.create({ maxCostUsd, deadline: T0 }).ok).toBe(false);
  });

  it('rejects an invalid deadline or duration', () => {
    expect(JobBudget.create({ maxCostUsd: 1, deadline: new Date('nope') }).ok).toBe(false);
    expect(JobBudget.startingAt(T0, 1, 0).ok).toBe(false);
  });

  it('derives the deadline from the request time', () => {
    const b = unwrap(JobBudget.startingAt(T0, 5, 60_000));
    expect(b.deadline).toEqual(at(60));
    expect(b.isPastDeadline(at(60))).toBe(false);
    expect(b.isPastDeadline(at(61))).toBe(true);
  });
});

describe('ImprovementJob AI budget', () => {
  it('accumulates AI cost and reports what remains', () => {
    const job = runningJob();
    job.recordAiCost(1.25, at(2));
    job.recordAiCost(0.1, at(3));
    expect(job.aiCostUsd).toBe(1.35);
    expect(job.remainingBudgetUsd()).toBeCloseTo(3.65);
    expect(job.isOverBudget(at(3))).toBe(false);
    expect(job.budgetViolation(at(3))).toBeNull();
  });

  it('is over budget once the spend reaches the limit', () => {
    const job = runningJob(budget(1));
    job.recordAiCost(1.2, at(2));
    expect(job.remainingBudgetUsd()).toBe(0);
    expect(job.budgetViolation(at(2))).toBe('AI budget exceeded');
    expect(job.isOverBudget(at(2))).toBe(true);
  });

  it('is over budget after the deadline', () => {
    const job = runningJob(budget(5, 60));
    expect(job.budgetViolation(at(61))).toBe('Job deadline exceeded');
  });

  it('has no limits without a budget (jobs created before budgets existed)', () => {
    const job = runningJob(null);
    job.recordAiCost(100, at(2));
    expect(job.remainingBudgetUsd()).toBe(Number.POSITIVE_INFINITY);
    expect(job.isOverBudget(at(1_000_000))).toBe(false);
  });

  it('validates recorded costs and requires a running job', () => {
    const job = runningJob();
    expect(() => job.recordAiCost(-0.01, at(2))).toThrow(ValidationError);
    expect(() => job.recordAiCost(Number.NaN, at(2))).toThrow(ValidationError);
    const queued = ImprovementJob.request({
      id: 'j2',
      repositoryId: 'r',
      targetFile: path('src/a.ts'),
      now: T0,
    });
    expect(() => queued.recordAiCost(1, at(1))).toThrow(IllegalStateTransitionError);
    expect(queued.budget).toBeNull();
  });
});
