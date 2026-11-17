import { CoveragePercentage } from '../../domain/coverage/coverage-percentage';
import { ImprovementJob } from '../../domain/job/improvement-job';
import { ImprovementJobRepository } from '../../domain/job/improvement-job-repository';
import { ChangedFile, ImprovementVerifier, VerificationOutcome } from '../../domain/job/improvement-verifier';
import { JobPhase } from '../../domain/job/job-status';
import { TestPlan } from '../../domain/job/test-plan';
import { Repository } from '../../domain/repository/repository';
import { RepositoryRepository } from '../../domain/repository/repository-repository';
import { Clock } from '../../domain/shared/clock';
import { ConcurrencyConflictError } from '../../domain/shared/domain-error';
import { errorMessage, LeaseLostError, NotFoundError } from '../errors';
import { AiTestGeneratorPort, TestGenerationContext } from '../ports/ai-test-generator.port';
import { CoverageRunnerPort, FileMeasurement } from '../ports/coverage-runner.port';
import { GitPort } from '../ports/git.port';
import { JobQueuePort } from '../ports/job-queue.port';
import { LeaseHandle, LeaseKeeperPort } from '../ports/lease-keeper.port';
import { LoggerPort } from '../ports/logger.port';
import { PullRequestPort } from '../ports/pull-request.port';
import { WorkspacePort } from '../ports/workspace.port';
import { PullRequestDescription } from '../services/pull-request-description';

/** Files that could steer the AI agent if left in the clone (prompt-injection hardening). */
export const HARDENING_PATHS = ['.claude', 'CLAUDE.md', 'CLAUDE.local.md'];

export type AiMode = 'single' | 'plan-and-write';

export interface ProcessNextJobOptions {
  aiMode: AiMode;
  maxFixAttempts: number;
  leaseMs: number;
  keepFailedWorkspaces: boolean;
}

export interface ProcessNextJobDeps {
  jobs: ImprovementJobRepository;
  queue: JobQueuePort;
  repositories: RepositoryRepository;
  workspace: WorkspacePort;
  git: GitPort;
  coverage: CoverageRunnerPort;
  ai: AiTestGeneratorPort;
  pullRequests: PullRequestPort;
  leaseKeeper: LeaseKeeperPort;
  clock: Clock;
  logger: LoggerPort;
}

export type ProcessOutcome =
  | { kind: 'idle' }
  | { kind: 'completed'; jobId: string; prUrl: string }
  | { kind: 'failed'; jobId: string; error: string }
  /** The lease was lost (e.g. the reaper requeued the job); the job now belongs to someone else. */
  | { kind: 'abandoned'; jobId: string; reason: string };

class VerificationFailedError extends Error {}

interface RunState {
  job: ImprovementJob;
  lease: LeaseHandle;
  dir: string | null;
}

/**
 * Claims the next job and runs the whole pipeline:
 * cloning -> (planning) -> writing -> verifying <-> fixing -> opening_pr -> completed.
 *
 * Every phase change is persisted before the slow work of that phase starts, so the dashboard shows
 * live progress and a crash leaves an accurate record. Persisting checks the lease first and uses
 * optimistic concurrency, so a worker that lost its job stops instead of overwriting another worker.
 */
export class ProcessNextJob {
  private readonly verifier = new ImprovementVerifier();

  constructor(
    private readonly deps: ProcessNextJobDeps,
    private readonly options: ProcessNextJobOptions,
  ) {}

  async execute(workerId: string): Promise<ProcessOutcome> {
    const job = await this.deps.queue.claimNext(workerId, this.options.leaseMs);
    if (!job) {
      return { kind: 'idle' };
    }
    const state: RunState = { job, lease: this.deps.leaseKeeper.keepAlive(job.id, workerId), dir: null };
    this.deps.logger.info('Job claimed', { jobId: job.id, workerId, attempt: job.attempts });

    let outcome: ProcessOutcome;
    try {
      const prUrl = await this.runPipeline(state);
      outcome = { kind: 'completed', jobId: job.id, prUrl };
    } catch (error) {
      outcome = await this.handleFailure(state, error);
    } finally {
      state.lease.stop();
    }
    await this.cleanUp(state, outcome);
    this.deps.logger.info('Job finished', { ...outcome });
    return outcome;
  }

  private async runPipeline(state: RunState): Promise<string> {
    const { job } = state;
    const repository = await this.deps.repositories.findById(job.repositoryId);
    if (!repository) {
      throw new NotFoundError('Repository', job.repositoryId);
    }

    // cloning: fresh clone, job branch, hardening, dependencies, baseline coverage
    state.dir = await this.deps.workspace.create('job', job.id);
    const dir = state.dir;
    await this.deps.git.clone(repository.url, dir);
    await this.deps.git.createBranch(dir, this.branchOf(job));
    const removedPaths = await this.deps.workspace.removePaths(dir, HARDENING_PATHS);
    await this.deps.coverage.installDependencies(dir);
    const before = await this.deps.coverage.measureFile(dir, job.targetFile);
    const coverageBefore = before.coverage?.lines ?? CoveragePercentage.zero();
    job.recordCoverageBefore(coverageBefore, this.now());
    await this.persist(state);

    const context: TestGenerationContext = {
      workspaceDir: dir,
      targetFile: job.targetFile,
      suggestedTestFile: job.targetFile.defaultTestFile(),
      coverage: before.coverage,
      uncoveredLines: before.uncoveredLines,
    };

    const plan = await this.planAndWrite(state, context);

    // verifying <-> fixing
    let measurement: FileMeasurement;
    let changedFiles: ChangedFile[];
    for (;;) {
      await this.advance(state, 'verifying');
      measurement = await this.deps.coverage.measureFile(dir, job.targetFile);
      changedFiles = await this.deps.git.changedFiles(dir);
      const verification = this.verifier.verify({
        changedFiles,
        expectedDeletions: removedPaths,
        testsPassed: measurement.testsPassed,
        coverageBefore,
        coverageAfter: measurement.coverage?.lines ?? null,
      });
      if (measurement.coverage) {
        job.recordCoverageAfter(measurement.coverage.lines, this.now());
      }
      if (verification.passed) {
        break;
      }
      if (job.fixAttempts >= this.options.maxFixAttempts) {
        throw new VerificationFailedError(this.describeFailure(verification, job.fixAttempts));
      }
      await this.advance(state, 'fixing');
      await this.deps.ai.fix(context, plan, verification.failures, measurement.output);
    }

    // opening_pr
    await this.advance(state, 'opening_pr');
    // Verification passed, so coverage was measured.
    const coverageAfter = measurement.coverage!.lines;
    const testFiles = this.verifier.testFilesToCommit(changedFiles);
    const description = new PullRequestDescription({
      jobId: job.id,
      targetFile: job.targetFile,
      coverageBefore,
      coverageAfter,
      plan,
      testFiles,
    });
    const branch = this.branchOf(job);
    await this.deps.git.commit(dir, testFiles, description.commitMessage);
    await this.deps.git.push(dir, repository.url, branch);
    const prUrl = await this.deps.pullRequests.open({
      repository: repository.url,
      head: branch,
      base: this.baseBranchOf(repository),
      title: description.title,
      body: description.body,
    });

    job.complete(prUrl, coverageAfter, this.now());
    await this.persist(state);
    return prUrl.value;
  }

  private async planAndWrite(state: RunState, context: TestGenerationContext): Promise<TestPlan> {
    const { job } = state;
    if (this.options.aiMode === 'single') {
      await this.advance(state, 'writing');
      const plan = await this.deps.ai.planAndWrite(context);
      job.recordPlan(plan, this.now());
      await this.persist(state);
      return plan;
    }
    await this.advance(state, 'planning');
    const plan = await this.deps.ai.plan(context);
    job.recordPlan(plan, this.now());
    await this.advance(state, 'writing');
    await this.deps.ai.write({ ...context, suggestedTestFile: plan.testFile }, plan);
    return plan;
  }

  private async handleFailure(state: RunState, error: unknown): Promise<ProcessOutcome> {
    const { job } = state;
    if (error instanceof LeaseLostError || error instanceof ConcurrencyConflictError) {
      this.deps.logger.warn('Abandoning job: lease lost', { jobId: job.id, reason: error.message });
      return { kind: 'abandoned', jobId: job.id, reason: error.message };
    }
    const reason = errorMessage(error);
    this.deps.logger.warn('Job failed', { jobId: job.id, phase: job.phase, reason });
    try {
      job.fail(reason, this.now());
      await this.deps.jobs.save(job);
    } catch (saveError) {
      // Most likely the lease was lost meanwhile; the reaper or the new owner will deal with the job.
      this.deps.logger.error('Could not record job failure', {
        jobId: job.id,
        error: errorMessage(saveError),
      });
      return { kind: 'abandoned', jobId: job.id, reason: errorMessage(saveError) };
    }
    return { kind: 'failed', jobId: job.id, error: reason };
  }

  private async cleanUp(state: RunState, outcome: ProcessOutcome): Promise<void> {
    if (!state.dir) {
      return;
    }
    if (outcome.kind === 'failed' && this.options.keepFailedWorkspaces) {
      this.deps.logger.info('Keeping failed workspace for inspection', {
        jobId: state.job.id,
        dir: state.dir,
      });
      return;
    }
    await this.deps.workspace.remove(state.dir).catch((error: unknown) => {
      this.deps.logger.warn('Could not remove job workspace', { dir: state.dir, error: errorMessage(error) });
    });
  }

  private async advance(state: RunState, phase: JobPhase): Promise<void> {
    state.job.advanceTo(phase, this.now());
    await this.persist(state);
  }

  private async persist(state: RunState): Promise<void> {
    if (state.lease.isLost()) {
      throw new LeaseLostError(state.job.id);
    }
    await this.deps.jobs.save(state.job);
  }

  private branchOf(job: ImprovementJob): string {
    return job.branchName ?? job.proposedBranchName();
  }

  private baseBranchOf(repository: Repository): string {
    return repository.defaultBranch ?? 'main';
  }

  private describeFailure(verification: VerificationOutcome, fixAttempts: number): string {
    return `Verification failed after ${fixAttempts} fix attempt(s): ${verification.failures.join(' ')}`;
  }

  private now(): Date {
    return this.deps.clock.now();
  }
}
