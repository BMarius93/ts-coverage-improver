import { CoveragePercentage } from '../../../domain/coverage/coverage-percentage';
import { FilePath } from '../../../domain/coverage/file-path';
import { ImprovementJob, TimelineEntry, TimelineEvent } from '../../../domain/job/improvement-job';
import { JobBudget } from '../../../domain/job/job-budget';
import { JobPhase, JobStatus } from '../../../domain/job/job-status';
import { PullRequestUrl } from '../../../domain/job/pull-request-url';
import { TestPlan, TestPlanProps } from '../../../domain/job/test-plan';
import { unwrap } from '../../../domain/shared/result';

export interface JobRow {
  id: string;
  repository_id: string;
  target_file: string;
  status: JobStatus;
  phase: JobPhase | null;
  attempts: number;
  fix_attempts: number;
  worker_id: string | null;
  lease_until: number | null;
  branch_name: string | null;
  coverage_before: number | null;
  coverage_after: number | null;
  test_plan: string | null;
  reverted_files: string;
  ai_cost_usd: number;
  budget_max_cost_usd: number | null;
  budget_deadline: string | null;
  pr_url: string | null;
  error: string | null;
  timeline: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  version: number;
}

/** Columns written from the aggregate (lease_until is owned by the queue, not the aggregate). */
export type JobColumns = Omit<JobRow, 'lease_until'>;

interface StoredTimelineEntry {
  event: TimelineEvent;
  at: string;
  note?: string;
}

const date = (value: string | null): Date | null => (value === null ? null : new Date(value));
const pct = (value: number | null): CoveragePercentage | null =>
  value === null ? null : unwrap(CoveragePercentage.create(value));

export function toJobColumns(job: ImprovementJob): JobColumns {
  const timeline: StoredTimelineEntry[] = job.timeline.map((entry) => ({
    event: entry.event,
    at: entry.at.toISOString(),
    ...(entry.note === undefined ? {} : { note: entry.note }),
  }));
  return {
    id: job.id,
    repository_id: job.repositoryId,
    target_file: job.targetFile.value,
    status: job.status,
    phase: job.phase,
    attempts: job.attempts,
    fix_attempts: job.fixAttempts,
    worker_id: job.workerId,
    branch_name: job.branchName,
    coverage_before: job.coverageBefore?.value ?? null,
    coverage_after: job.coverageAfter?.value ?? null,
    test_plan: job.testPlan ? JSON.stringify(job.testPlan.toProps()) : null,
    reverted_files: JSON.stringify(job.revertedFiles),
    ai_cost_usd: job.aiCostUsd,
    budget_max_cost_usd: job.budget?.maxCostUsd ?? null,
    budget_deadline: job.budget?.deadline.toISOString() ?? null,
    pr_url: job.prUrl?.value ?? null,
    error: job.error,
    timeline: JSON.stringify(timeline),
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    finished_at: job.finishedAt?.toISOString() ?? null,
    version: job.version,
  };
}

export function toJob(row: JobRow): ImprovementJob {
  const timeline = (JSON.parse(row.timeline) as StoredTimelineEntry[]).map((entry): TimelineEntry => ({
    event: entry.event,
    at: new Date(entry.at),
    ...(entry.note === undefined ? {} : { note: entry.note }),
  }));
  return ImprovementJob.reconstitute({
    id: row.id,
    repositoryId: row.repository_id,
    targetFile: unwrap(FilePath.create(row.target_file)),
    status: row.status,
    phase: row.phase,
    attempts: row.attempts,
    fixAttempts: row.fix_attempts,
    workerId: row.worker_id,
    branchName: row.branch_name,
    coverageBefore: pct(row.coverage_before),
    coverageAfter: pct(row.coverage_after),
    testPlan: row.test_plan ? unwrap(TestPlan.create(JSON.parse(row.test_plan) as TestPlanProps)) : null,
    revertedFiles: JSON.parse(row.reverted_files) as string[],
    budget:
      row.budget_max_cost_usd === null || row.budget_deadline === null
        ? null
        : unwrap(
            JobBudget.create({
              maxCostUsd: row.budget_max_cost_usd,
              deadline: new Date(row.budget_deadline),
            }),
          ),
    aiCostUsd: row.ai_cost_usd,
    prUrl: row.pr_url ? unwrap(PullRequestUrl.create(row.pr_url)) : null,
    error: row.error,
    timeline,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    startedAt: date(row.started_at),
    finishedAt: date(row.finished_at),
    version: row.version,
  });
}
