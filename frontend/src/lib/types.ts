/** Mirrors the backend read models in backend/src/application/views.ts. */

export type ScanStatus = 'never_scanned' | 'scanning' | 'succeeded' | 'failed';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type JobPhase = 'cloning' | 'planning' | 'writing' | 'verifying' | 'fixing' | 'opening_pr';

export interface SnapshotSummary {
  commitSha: string;
  takenAt: string;
  fileCount: number;
  filesBelowThreshold: number;
  filesSkipped: number;
  averageLineCoverage: number | null;
}

export interface Repository {
  id: string;
  url: string;
  owner: string;
  name: string;
  defaultBranch: string | null;
  scanStatus: ScanStatus;
  scanError: string | null;
  scanStartedAt: string | null;
  threshold: number;
  latestSnapshot: SnapshotSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEntry {
  event: string;
  at: string;
  note: string | null;
}

export interface TestPlan {
  testFilePath: string;
  summary: string;
  cases: Array<{ name: string; covers: string }>;
}

export interface Job {
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
  testPlan: TestPlan | null;
  revertedFiles: string[];
  aiCostUsd: number;
  budget: { maxCostUsd: number; deadline: string } | null;
  prUrl: string | null;
  error: string | null;
  timeline: TimelineEntry[];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type FileKind = 'module' | 're-export-only';

export interface FileRow {
  path: string;
  kind: FileKind;
  /** Why the file is never offered for improvement, e.g. 're-exports only'. */
  skippedReason: string | null;
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  belowThreshold: boolean;
  latestJob: Job | null;
}
