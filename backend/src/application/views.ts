import { CoverageAnalyzer } from '../domain/coverage/coverage-analyzer';
import { CoverageThreshold } from '../domain/coverage/coverage-threshold';
import { FileCoverage } from '../domain/coverage/file-coverage';
import { ImprovementJob } from '../domain/job/improvement-job';
import { JobPhase, JobStatus } from '../domain/job/job-status';
import { TestPlanProps } from '../domain/job/test-plan';
import { Repository, ScanStatus } from '../domain/repository/repository';

/** Read models returned by use cases. Plain, serialisable data: no domain objects leak out. */

export interface SnapshotSummaryView {
  commitSha: string;
  takenAt: string;
  fileCount: number;
  filesBelowThreshold: number;
  averageLineCoverage: number | null;
}

export interface RepositoryView {
  id: string;
  url: string;
  owner: string;
  name: string;
  defaultBranch: string | null;
  scanStatus: ScanStatus;
  scanError: string | null;
  scanStartedAt: string | null;
  threshold: number;
  latestSnapshot: SnapshotSummaryView | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEntryView {
  event: string;
  at: string;
  note: string | null;
}

export interface JobView {
  id: string;
  repositoryId: string;
  targetFile: string;
  status: JobStatus;
  phase: JobPhase | null;
  attempts: number;
  fixAttempts: number;
  branchName: string | null;
  coverageBefore: number | null;
  coverageAfter: number | null;
  testPlan: TestPlanProps | null;
  prUrl: string | null;
  error: string | null;
  timeline: TimelineEntryView[];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface FileView {
  path: string;
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  belowThreshold: boolean;
  latestJob: JobView | null;
}

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

export function toJobView(job: ImprovementJob): JobView {
  return {
    id: job.id,
    repositoryId: job.repositoryId,
    targetFile: job.targetFile.value,
    status: job.status,
    phase: job.phase,
    attempts: job.attempts,
    fixAttempts: job.fixAttempts,
    branchName: job.branchName,
    coverageBefore: job.coverageBefore?.value ?? null,
    coverageAfter: job.coverageAfter?.value ?? null,
    testPlan: job.testPlan?.toProps() ?? null,
    prUrl: job.prUrl?.value ?? null,
    error: job.error,
    timeline: job.timeline.map((entry) => ({
      event: entry.event,
      at: entry.at.toISOString(),
      note: entry.note ?? null,
    })),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
  };
}

export function toRepositoryView(
  repository: Repository,
  threshold: CoverageThreshold,
  analyzer: CoverageAnalyzer,
): RepositoryView {
  const snapshot = repository.latestSnapshot;
  let latestSnapshot: SnapshotSummaryView | null = null;
  if (snapshot) {
    const files = snapshot.files;
    const average =
      files.length === 0 ? null : files.reduce((sum, file) => sum + file.lines.value, 0) / files.length;
    latestSnapshot = {
      commitSha: snapshot.commitSha,
      takenAt: snapshot.takenAt.toISOString(),
      fileCount: files.length,
      filesBelowThreshold: analyzer.filesNeedingImprovement(snapshot, threshold).length,
      averageLineCoverage: average === null ? null : Math.round(average * 100) / 100,
    };
  }
  return {
    id: repository.id,
    url: repository.url.webUrl,
    owner: repository.url.owner,
    name: repository.url.name,
    defaultBranch: repository.defaultBranch,
    scanStatus: repository.scanStatus,
    scanError: repository.scanError,
    scanStartedAt: iso(repository.scanStartedAt),
    threshold: threshold.value,
    latestSnapshot,
    createdAt: repository.createdAt.toISOString(),
    updatedAt: repository.updatedAt.toISOString(),
  };
}

export function toFileView(
  file: FileCoverage,
  belowThreshold: boolean,
  latestJob: ImprovementJob | null,
): FileView {
  return {
    path: file.path.value,
    lines: file.metrics.lines.value,
    branches: file.metrics.branches.value,
    functions: file.metrics.functions.value,
    statements: file.metrics.statements.value,
    belowThreshold,
    latestJob: latestJob ? toJobView(latestJob) : null,
  };
}
