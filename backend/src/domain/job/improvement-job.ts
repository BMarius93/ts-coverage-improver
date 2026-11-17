import { CoveragePercentage } from '../coverage/coverage-percentage';
import { FilePath } from '../coverage/file-path';
import { IllegalStateTransitionError, ValidationError } from '../shared/domain-error';
import { canAdvance, JobPhase, JobStatus } from './job-status';
import { PullRequestUrl } from './pull-request-url';
import { TestPlan } from './test-plan';

export type TimelineEvent = JobStatus | JobPhase | 'requeued';

export interface TimelineEntry {
  event: TimelineEvent;
  at: Date;
  note?: string;
}

export interface ImprovementJobProps {
  id: string;
  repositoryId: string;
  targetFile: FilePath;
  status: JobStatus;
  phase: JobPhase | null;
  attempts: number;
  fixAttempts: number;
  workerId: string | null;
  branchName: string | null;
  coverageBefore: CoveragePercentage | null;
  coverageAfter: CoveragePercentage | null;
  testPlan: TestPlan | null;
  /** Non-test files the AI changed that the pipeline restored before verification. */
  revertedFiles: string[];
  prUrl: PullRequestUrl | null;
  error: string | null;
  timeline: TimelineEntry[];
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  version: number;
}

export type LeaseExpiryOutcome = 'requeued' | 'failed';

const MAX_ERROR_LENGTH = 4000;

/**
 * Aggregate root for one "improve the tests of this file" request.
 *
 *   queued --start--> running --complete--> completed
 *     ^                  |  \--fail------> failed
 *     +----requeue-------+
 *   queued --fail--> failed
 *
 * While running, the job moves through phases (see job-status.ts). Every transition is checked here,
 * so persistence and workers cannot put a job into an impossible state.
 */
export class ImprovementJob {
  private constructor(private props: ImprovementJobProps) {}

  static request(params: {
    id: string;
    repositoryId: string;
    targetFile: FilePath;
    now: Date;
  }): ImprovementJob {
    if (params.id.trim() === '' || params.repositoryId.trim() === '') {
      throw new ValidationError('Job id and repository id are required');
    }
    if (params.targetFile.isTestFile || params.targetFile.isDeclarationFile) {
      throw new ValidationError(
        `Cannot improve coverage of a test or declaration file: ${params.targetFile.value}`,
      );
    }
    return new ImprovementJob({
      id: params.id,
      repositoryId: params.repositoryId,
      targetFile: params.targetFile,
      status: 'queued',
      phase: null,
      attempts: 0,
      fixAttempts: 0,
      workerId: null,
      branchName: null,
      coverageBefore: null,
      coverageAfter: null,
      testPlan: null,
      revertedFiles: [],
      prUrl: null,
      error: null,
      timeline: [{ event: 'queued', at: params.now }],
      createdAt: params.now,
      updatedAt: params.now,
      startedAt: null,
      finishedAt: null,
      version: 0,
    });
  }

  /** Rebuilds an aggregate from persistence; the data is trusted to already satisfy invariants. */
  static reconstitute(props: ImprovementJobProps): ImprovementJob {
    return new ImprovementJob({
      ...props,
      timeline: [...props.timeline],
      revertedFiles: [...props.revertedFiles],
    });
  }

  get id(): string {
    return this.props.id;
  }
  get repositoryId(): string {
    return this.props.repositoryId;
  }
  get targetFile(): FilePath {
    return this.props.targetFile;
  }
  get status(): JobStatus {
    return this.props.status;
  }
  get phase(): JobPhase | null {
    return this.props.phase;
  }
  get attempts(): number {
    return this.props.attempts;
  }
  get fixAttempts(): number {
    return this.props.fixAttempts;
  }
  get workerId(): string | null {
    return this.props.workerId;
  }
  get branchName(): string | null {
    return this.props.branchName;
  }
  get coverageBefore(): CoveragePercentage | null {
    return this.props.coverageBefore;
  }
  get coverageAfter(): CoveragePercentage | null {
    return this.props.coverageAfter;
  }
  get testPlan(): TestPlan | null {
    return this.props.testPlan;
  }
  get revertedFiles(): readonly string[] {
    return this.props.revertedFiles;
  }
  get prUrl(): PullRequestUrl | null {
    return this.props.prUrl;
  }
  get error(): string | null {
    return this.props.error;
  }
  get timeline(): readonly TimelineEntry[] {
    return this.props.timeline;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get startedAt(): Date | null {
    return this.props.startedAt;
  }
  get finishedAt(): Date | null {
    return this.props.finishedAt;
  }
  /** Optimistic-concurrency token; repositories compare it on update and call `markSaved()`. */
  get version(): number {
    return this.props.version;
  }

  get isActive(): boolean {
    return this.props.status === 'queued' || this.props.status === 'running';
  }

  get isFinished(): boolean {
    return this.props.status === 'completed' || this.props.status === 'failed';
  }

  /** Branch the job pushes to: `coverage/<file-slug>-<first 8 chars of the job id>`. */
  proposedBranchName(): string {
    const shortId = this.props.id
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 8)
      .toLowerCase();
    return `coverage/${this.props.targetFile.slug()}-${shortId}`;
  }

  start(workerId: string, now: Date): void {
    this.assertStatus('queued', 'start');
    if (workerId.trim() === '') {
      throw new ValidationError('Worker id is required');
    }
    this.props = {
      ...this.props,
      status: 'running',
      phase: 'cloning',
      workerId,
      attempts: this.props.attempts + 1,
      fixAttempts: 0,
      branchName: this.proposedBranchName(),
      startedAt: this.props.startedAt ?? now,
      error: null,
    };
    this.record('running', now, `attempt ${this.props.attempts}`);
    this.record('cloning', now);
  }

  advanceTo(phase: JobPhase, now: Date): void {
    this.assertStatus('running', `advance to ${phase}`);
    const current = this.props.phase as JobPhase;
    if (!canAdvance(current, phase)) {
      throw new IllegalStateTransitionError('ImprovementJob', `in phase ${current}`, `advance to ${phase}`);
    }
    this.props = {
      ...this.props,
      phase,
      fixAttempts: phase === 'fixing' ? this.props.fixAttempts + 1 : this.props.fixAttempts,
    };
    this.record(phase, now);
  }

  recordCoverageBefore(coverage: CoveragePercentage, now: Date): void {
    this.assertStatus('running', 'record coverage');
    this.props = { ...this.props, coverageBefore: coverage, updatedAt: now };
  }

  recordPlan(plan: TestPlan, now: Date): void {
    this.assertStatus('running', 'record a test plan');
    if (this.props.phase !== 'planning' && this.props.phase !== 'writing') {
      throw new IllegalStateTransitionError(
        'ImprovementJob',
        `in phase ${this.props.phase}`,
        'record a test plan',
      );
    }
    this.props = { ...this.props, testPlan: plan, updatedAt: now };
  }

  /** Remembers non-test files that were restored (accumulated across fix rounds, without duplicates). */
  recordRevertedFiles(paths: string[], now: Date): void {
    this.assertStatus('running', 'record reverted files');
    if (paths.length === 0) return;
    const revertedFiles = [...new Set([...this.props.revertedFiles, ...paths])].sort();
    this.props = { ...this.props, revertedFiles, updatedAt: now };
  }

  complete(prUrl: PullRequestUrl, coverageAfter: CoveragePercentage, now: Date): void {
    this.assertStatus('running', 'complete');
    if (this.props.phase !== 'opening_pr') {
      throw new IllegalStateTransitionError('ImprovementJob', `in phase ${this.props.phase}`, 'complete');
    }
    const before = this.props.coverageBefore;
    if (before !== null && !coverageAfter.isGreaterThan(before)) {
      throw new ValidationError(
        `A completed job must increase coverage (${before.toString()} -> ${coverageAfter.toString()})`,
      );
    }
    this.props = {
      ...this.props,
      status: 'completed',
      phase: null,
      prUrl,
      coverageAfter,
      workerId: null,
      finishedAt: now,
    };
    this.record('completed', now);
  }

  /** Records the measured coverage even when the job then fails, so the dashboard can show it. */
  recordCoverageAfter(coverage: CoveragePercentage, now: Date): void {
    this.assertStatus('running', 'record coverage');
    this.props = { ...this.props, coverageAfter: coverage, updatedAt: now };
  }

  fail(reason: string, now: Date): void {
    if (this.isFinished) {
      throw new IllegalStateTransitionError('ImprovementJob', this.props.status, 'fail');
    }
    const error = reason.trim() === '' ? 'Unknown error' : reason.trim().slice(0, MAX_ERROR_LENGTH);
    // `phase` is deliberately kept so the dashboard can show where the job failed.
    this.props = { ...this.props, status: 'failed', error, workerId: null, finishedAt: now };
    this.record('failed', now, this.props.phase ? `during ${this.props.phase}` : undefined);
  }

  /** Puts a running job back in the queue, e.g. after its worker died. Attempts are kept. */
  requeue(now: Date, reason: string): void {
    this.assertStatus('running', 'requeue');
    this.props = { ...this.props, status: 'queued', phase: null, workerId: null, fixAttempts: 0 };
    this.record('requeued', now, reason);
  }

  /** Reaper rule: retry while attempts remain, otherwise give up. */
  handleExpiredLease(maxAttempts: number, now: Date): LeaseExpiryOutcome {
    this.assertStatus('running', 'expire');
    if (this.props.attempts >= maxAttempts) {
      this.fail(`Worker lease expired ${this.props.attempts} time(s); giving up`, now);
      return 'failed';
    }
    this.requeue(now, 'worker lease expired');
    return 'requeued';
  }

  markSaved(): void {
    this.props = { ...this.props, version: this.props.version + 1 };
  }

  private assertStatus(expected: JobStatus, action: string): void {
    if (this.props.status !== expected) {
      throw new IllegalStateTransitionError('ImprovementJob', this.props.status, action);
    }
  }

  private record(event: TimelineEvent, at: Date, note?: string): void {
    const entry: TimelineEntry = note === undefined ? { event, at } : { event, at, note };
    this.props = { ...this.props, timeline: [...this.props.timeline, entry], updatedAt: at };
  }
}
