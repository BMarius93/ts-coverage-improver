import {
  AiCallLimits,
  AiCallResult,
  AiPlanResult,
  AiTestGeneratorPort,
  TestGenerationContext,
} from '../../src/application/ports/ai-test-generator.port';
import {
  CoverageRunnerPort,
  FileMeasurement,
  RepositoryCoverage,
} from '../../src/application/ports/coverage-runner.port';
import { GitPort } from '../../src/application/ports/git.port';
import { JobQueuePort } from '../../src/application/ports/job-queue.port';
import { LeaseHandle, LeaseKeeperPort } from '../../src/application/ports/lease-keeper.port';
import { LoggerPort } from '../../src/application/ports/logger.port';
import { OpenPullRequest, PullRequestPort } from '../../src/application/ports/pull-request.port';
import { WorkspacePort } from '../../src/application/ports/workspace.port';
import { FilePath } from '../../src/domain/coverage/file-path';
import { ImprovementJob } from '../../src/domain/job/improvement-job';
import { ImprovementJobRepository } from '../../src/domain/job/improvement-job-repository';
import { ChangedFile } from '../../src/domain/job/improvement-verifier';
import { JobSchedulingPolicy } from '../../src/domain/job/job-scheduling-policy';
import { PullRequestUrl } from '../../src/domain/job/pull-request-url';
import { TestPlan } from '../../src/domain/job/test-plan';
import { GitHubRepoUrl } from '../../src/domain/repository/github-repo-url';
import { Repository } from '../../src/domain/repository/repository';
import { RepositoryRepository } from '../../src/domain/repository/repository-repository';
import { Clock } from '../../src/domain/shared/clock';
import { ConcurrencyConflictError } from '../../src/domain/shared/domain-error';
import { IdGenerator } from '../../src/domain/shared/id-generator';
import { unwrap } from '../../src/domain/shared/result';
import { fileCoverage, plan as buildPlan, T0 } from './builders';

export class FixedClock implements Clock {
  constructor(private current: Date = T0) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequentialIds implements IdGenerator {
  private counter = 0;
  constructor(private readonly prefix = 'id') {}
  next(): string {
    this.counter++;
    return `${this.prefix}-${String(this.counter).padStart(8, '0')}`;
  }
}

export class RecordingLogger implements LoggerPort {
  readonly entries: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
  info(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'info', message, context });
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'warn', message, context });
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'error', message, context });
  }
}

/** Copies an aggregate the way a database round-trip would, so tests cannot share object identity. */
function copyRepository(repository: Repository): Repository {
  return Repository.reconstitute({
    id: repository.id,
    url: repository.url,
    defaultBranch: repository.defaultBranch,
    scanStatus: repository.scanStatus,
    scanError: repository.scanError,
    scanStartedAt: repository.scanStartedAt,
    latestSnapshot: repository.latestSnapshot,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  });
}

export function copyJob(job: ImprovementJob): ImprovementJob {
  return ImprovementJob.reconstitute({
    id: job.id,
    repositoryId: job.repositoryId,
    targetFile: job.targetFile,
    status: job.status,
    phase: job.phase,
    attempts: job.attempts,
    fixAttempts: job.fixAttempts,
    workerId: job.workerId,
    branchName: job.branchName,
    coverageBefore: job.coverageBefore,
    coverageAfter: job.coverageAfter,
    testPlan: job.testPlan,
    revertedFiles: [...job.revertedFiles],
    budget: job.budget,
    aiCostUsd: job.aiCostUsd,
    prUrl: job.prUrl,
    error: job.error,
    timeline: [...job.timeline],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    version: job.version,
  });
}

export class InMemoryRepositoryRepository implements RepositoryRepository {
  private readonly items = new Map<string, Repository>();

  async save(repository: Repository): Promise<void> {
    this.items.set(repository.id, copyRepository(repository));
  }
  async findById(id: string): Promise<Repository | null> {
    const item = this.items.get(id);
    return item ? copyRepository(item) : null;
  }
  async findByUrl(url: GitHubRepoUrl): Promise<Repository | null> {
    const item = [...this.items.values()].find((repo) => repo.url.equals(url));
    return item ? copyRepository(item) : null;
  }
  async findAll(): Promise<Repository[]> {
    return [...this.items.values()].map(copyRepository);
  }
}

/** In-memory job repository + queue that follows the same rules as the SQLite adapter. */
export class InMemoryJobStore implements ImprovementJobRepository, JobQueuePort {
  private readonly items = new Map<string, ImprovementJob>();
  private readonly leases = new Map<string, number>();
  private readonly policy = new JobSchedulingPolicy();

  constructor(private readonly clock: Clock) {}

  async save(job: ImprovementJob): Promise<void> {
    const stored = this.items.get(job.id);
    if ((stored?.version ?? 0) !== job.version) {
      throw new ConcurrencyConflictError('ImprovementJob', job.id);
    }
    if (job.status !== 'running') {
      this.leases.delete(job.id);
    }
    job.markSaved();
    this.items.set(job.id, copyJob(job));
  }
  async findById(id: string): Promise<ImprovementJob | null> {
    const item = this.items.get(id);
    return item ? copyJob(item) : null;
  }
  async findByRepository(repositoryId: string): Promise<ImprovementJob[]> {
    return this.all()
      .filter((job) => job.repositoryId === repositoryId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  }
  async findActiveByRepository(repositoryId: string): Promise<ImprovementJob[]> {
    return (await this.findByRepository(repositoryId)).filter((job) => job.isActive);
  }

  async claimNext(workerId: string, leaseMs: number): Promise<ImprovementJob | null> {
    const all = this.all();
    const next = this.policy.pickNext(
      all.filter((job) => job.status === 'queued'),
      all.filter((job) => job.status === 'running'),
    );
    if (!next) {
      return null;
    }
    next.start(workerId, this.clock.now());
    await this.save(next);
    this.leases.set(next.id, this.clock.now().getTime() + leaseMs);
    return next;
  }
  async extendLease(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const job = this.items.get(jobId);
    if (!job || job.status !== 'running' || job.workerId !== workerId) {
      return false;
    }
    this.leases.set(jobId, this.clock.now().getTime() + leaseMs);
    return true;
  }
  async findExpiredLeases(): Promise<ImprovementJob[]> {
    const now = this.clock.now().getTime();
    return this.all().filter((job) => job.status === 'running' && (this.leases.get(job.id) ?? 0) < now);
  }

  private all(): ImprovementJob[] {
    return [...this.items.values()].map(copyJob);
  }
}

export class FakeWorkspace implements WorkspacePort {
  readonly created: string[] = [];
  readonly removed: string[] = [];
  /** Paths that "exist" in every clone and will be reported as removed by `removePaths`. */
  existingPaths = ['CLAUDE.md'];
  failOnCreate: Error | null = null;

  async create(kind: 'scan' | 'job', id: string): Promise<string> {
    if (this.failOnCreate) throw this.failOnCreate;
    const dir = `/workspaces/${kind}/${id}`;
    this.created.push(dir);
    return dir;
  }
  async remove(dir: string): Promise<void> {
    this.removed.push(dir);
  }
  async removePaths(_dir: string, relativePaths: string[]): Promise<string[]> {
    return relativePaths.filter((path) => this.existingPaths.includes(path));
  }
}

export class FakeGit implements GitPort {
  readonly calls: string[] = [];
  readonly commits: Array<{ files: string[]; message: string }> = [];
  readonly pushes: string[] = [];
  changes: ChangedFile[] = [{ path: 'src/price.test.ts', kind: 'added' }];
  failOn: Partial<Record<keyof GitPort, Error>> = {};
  commitSha = 'c0ffee0';
  branch = 'main';

  private check(method: keyof GitPort): void {
    this.calls.push(method);
    const failure = this.failOn[method];
    if (failure) throw failure;
  }
  async clone(_repository: GitHubRepoUrl, _dir: string): Promise<void> {
    this.check('clone');
  }
  async headCommit(): Promise<string> {
    this.check('headCommit');
    return this.commitSha;
  }
  async currentBranch(): Promise<string> {
    this.check('currentBranch');
    return this.branch;
  }
  async createBranch(_dir: string, branch: string): Promise<void> {
    this.check('createBranch');
    this.calls.push(`branch:${branch}`);
  }
  async changedFiles(): Promise<ChangedFile[]> {
    this.check('changedFiles');
    return this.changes;
  }
  /** Like git: drops every non-kept change from the fake working tree. */
  async restoreNonTestChanges(_dir: string, keep: (path: string) => boolean): Promise<string[]> {
    this.check('restoreNonTestChanges');
    const reverted = this.changes.filter((file) => !keep(file.path)).map((file) => file.path);
    this.changes = this.changes.filter((file) => keep(file.path));
    return reverted;
  }
  async commit(_dir: string, files: string[], message: string): Promise<void> {
    this.check('commit');
    this.commits.push({ files, message });
  }
  async push(_dir: string, _repository: GitHubRepoUrl, branch: string): Promise<void> {
    this.check('push');
    this.pushes.push(branch);
  }
}

export const measurement = (
  lines: number | null,
  testsPassed = true,
  file = 'src/price.ts',
): FileMeasurement => ({
  testsPassed,
  coverage: lines === null ? null : fileCoverage(file, lines),
  uncoveredLines: lines === null || lines < 100 ? [3, 4] : [],
  output: testsPassed ? 'PASS' : 'FAIL: expected 1 to be 2',
});

export class FakeCoverageRunner implements CoverageRunnerPort {
  repositoryCoverage: RepositoryCoverage = {
    files: [fileCoverage('src/price.ts', 10), fileCoverage('src/ok.ts', 90)],
    testsPassed: true,
  };
  /** Successive results of `measureFile`; the last one repeats. */
  fileMeasurements: FileMeasurement[] = [measurement(10), measurement(85)];
  failOn: Partial<Record<keyof CoverageRunnerPort, Error>> = {};
  measureFileCalls = 0;

  async installDependencies(): Promise<void> {
    if (this.failOn.installDependencies) throw this.failOn.installDependencies;
  }
  async measureRepository(): Promise<RepositoryCoverage> {
    if (this.failOn.measureRepository) throw this.failOn.measureRepository;
    return this.repositoryCoverage;
  }
  async measureFile(_dir: string, _target: FilePath): Promise<FileMeasurement> {
    if (this.failOn.measureFile) throw this.failOn.measureFile;
    const index = Math.min(this.measureFileCalls, this.fileMeasurements.length - 1);
    this.measureFileCalls++;
    return this.fileMeasurements[index];
  }
}

export class FakeAi implements AiTestGeneratorPort {
  readonly calls: string[] = [];
  readonly fixRequests: Array<{ failures: string[]; output: string }> = [];
  /** `--max-budget-usd` each call received. */
  readonly limits: number[] = [];
  testPlan: TestPlan = buildPlan();
  /** Cost reported by each call (by method), default 0.10. */
  costs: Partial<Record<keyof AiTestGeneratorPort, number>> = {};
  failOn: Partial<Record<keyof AiTestGeneratorPort, Error>> = {};
  /** Hook to simulate side effects (e.g. losing the lease while the AI works). */
  onCall: (method: keyof AiTestGeneratorPort) => void = () => undefined;

  private check(method: keyof AiTestGeneratorPort, limits: AiCallLimits): number {
    this.calls.push(method);
    this.limits.push(limits.maxBudgetUsd);
    this.onCall(method);
    const failure = this.failOn[method];
    if (failure) throw failure;
    return this.costs[method] ?? 0.1;
  }
  async plan(_context: TestGenerationContext, limits: AiCallLimits): Promise<AiPlanResult> {
    const costUsd = this.check('plan', limits);
    return { plan: this.testPlan, costUsd };
  }
  async write(_context: TestGenerationContext, _plan: TestPlan, limits: AiCallLimits): Promise<AiCallResult> {
    return { costUsd: this.check('write', limits) };
  }
  async planAndWrite(_context: TestGenerationContext, limits: AiCallLimits): Promise<AiPlanResult> {
    const costUsd = this.check('planAndWrite', limits);
    return { plan: this.testPlan, costUsd };
  }
  async fix(
    _context: TestGenerationContext,
    _plan: TestPlan,
    failures: string[],
    output: string,
    limits: AiCallLimits,
  ): Promise<AiCallResult> {
    const costUsd = this.check('fix', limits);
    this.fixRequests.push({ failures, output });
    return { costUsd };
  }
}

export class FakePullRequests implements PullRequestPort {
  readonly opened: OpenPullRequest[] = [];
  failure: Error | null = null;

  async open(request: OpenPullRequest): Promise<PullRequestUrl> {
    if (this.failure) throw this.failure;
    this.opened.push(request);
    return unwrap(PullRequestUrl.create(`${request.repository.webUrl}/pull/${this.opened.length}`));
  }
}

export class FakeLeaseKeeper implements LeaseKeeperPort {
  lost = false;
  readonly started: string[] = [];
  stopped = 0;

  keepAlive(jobId: string): LeaseHandle {
    this.started.push(jobId);
    return {
      isLost: () => this.lost,
      stop: () => {
        this.stopped++;
      },
    };
  }
}
