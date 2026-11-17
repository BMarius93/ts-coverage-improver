import { Module } from '@nestjs/common';
import { AI_TEST_GENERATOR_PORT, AiTestGeneratorPort } from '../application/ports/ai-test-generator.port';
import { CoverageRunnerPort, COVERAGE_RUNNER_PORT } from '../application/ports/coverage-runner.port';
import { GIT_PORT, GitPort } from '../application/ports/git.port';
import { JOB_QUEUE_PORT, JobQueuePort } from '../application/ports/job-queue.port';
import { LEASE_KEEPER_PORT, LeaseKeeperPort } from '../application/ports/lease-keeper.port';
import { LOGGER_PORT, LoggerPort } from '../application/ports/logger.port';
import { PULL_REQUEST_PORT, PullRequestPort } from '../application/ports/pull-request.port';
import { WORKSPACE_PORT, WorkspacePort } from '../application/ports/workspace.port';
import {
  CLOCK,
  ID_GENERATOR,
  IMPROVEMENT_JOB_REPOSITORY,
  REPOSITORY_REPOSITORY,
} from '../application/tokens';
import { GetDashboard } from '../application/use-cases/get-dashboard';
import { ProcessNextJob } from '../application/use-cases/process-next-job';
import { RecoverStaleJobs } from '../application/use-cases/recover-stale-jobs';
import { RegisterRepository } from '../application/use-cases/register-repository';
import { RequestImprovement } from '../application/use-cases/request-improvement';
import { ScanCoverage } from '../application/use-cases/scan-coverage';
import { CoverageThreshold } from '../domain/coverage/coverage-threshold';
import { ImprovementJobRepository } from '../domain/job/improvement-job-repository';
import { RepositoryRepository } from '../domain/repository/repository-repository';
import { Clock } from '../domain/shared/clock';
import { IdGenerator } from '../domain/shared/id-generator';
import { unwrap } from '../domain/shared/result';
import { APP_CONFIG, AppConfig } from '../infrastructure/config/app-config';
import { AdaptersModule } from './adapters.module';
import { PersistenceModule } from './persistence.module';

export const COVERAGE_THRESHOLD = Symbol('CoverageThreshold');

/**
 * Use cases are plain classes (no Nest decorators, see ADR-1.2); this module builds them from ports.
 */
@Module({
  imports: [PersistenceModule, AdaptersModule],
  providers: [
    {
      provide: COVERAGE_THRESHOLD,
      useFactory: (config: AppConfig) => unwrap(CoverageThreshold.create(config.COVERAGE_THRESHOLD)),
      inject: [APP_CONFIG],
    },
    {
      provide: RegisterRepository,
      useFactory: (
        repos: RepositoryRepository,
        ids: IdGenerator,
        clock: Clock,
        threshold: CoverageThreshold,
      ) => new RegisterRepository(repos, ids, clock, threshold),
      inject: [REPOSITORY_REPOSITORY, ID_GENERATOR, CLOCK, COVERAGE_THRESHOLD],
    },
    {
      provide: ScanCoverage,
      useFactory: (
        repos: RepositoryRepository,
        workspace: WorkspacePort,
        git: GitPort,
        coverage: CoverageRunnerPort,
        clock: Clock,
        logger: LoggerPort,
        threshold: CoverageThreshold,
      ) => new ScanCoverage(repos, workspace, git, coverage, clock, logger, threshold),
      inject: [
        REPOSITORY_REPOSITORY,
        WORKSPACE_PORT,
        GIT_PORT,
        COVERAGE_RUNNER_PORT,
        CLOCK,
        LOGGER_PORT,
        COVERAGE_THRESHOLD,
      ],
    },
    {
      provide: RequestImprovement,
      useFactory: (
        config: AppConfig,
        repos: RepositoryRepository,
        jobs: ImprovementJobRepository,
        ids: IdGenerator,
        clock: Clock,
      ) =>
        new RequestImprovement(repos, jobs, ids, clock, {
          maxCostUsd: config.AI_JOB_MAX_BUDGET_USD,
          maxDurationMs: config.JOB_DEADLINE_MS,
        }),
      inject: [APP_CONFIG, REPOSITORY_REPOSITORY, IMPROVEMENT_JOB_REPOSITORY, ID_GENERATOR, CLOCK],
    },
    {
      provide: GetDashboard,
      useFactory: (
        repos: RepositoryRepository,
        jobs: ImprovementJobRepository,
        threshold: CoverageThreshold,
      ) => new GetDashboard(repos, jobs, threshold),
      inject: [REPOSITORY_REPOSITORY, IMPROVEMENT_JOB_REPOSITORY, COVERAGE_THRESHOLD],
    },
    {
      provide: ProcessNextJob,
      useFactory: (
        config: AppConfig,
        jobs: ImprovementJobRepository,
        queue: JobQueuePort,
        repositories: RepositoryRepository,
        workspace: WorkspacePort,
        git: GitPort,
        coverage: CoverageRunnerPort,
        ai: AiTestGeneratorPort,
        pullRequests: PullRequestPort,
        leaseKeeper: LeaseKeeperPort,
        clock: Clock,
        logger: LoggerPort,
      ) =>
        new ProcessNextJob(
          {
            jobs,
            queue,
            repositories,
            workspace,
            git,
            coverage,
            ai,
            pullRequests,
            leaseKeeper,
            clock,
            logger,
          },
          {
            aiMode: config.AI_MODE,
            maxFixAttempts: config.AI_MAX_FIX_ATTEMPTS,
            verifyRuns: config.VERIFY_RUNS,
            maxBudgetPerCallUsd: config.AI_MAX_BUDGET_USD,
            leaseMs: config.JOB_LEASE_SECONDS * 1000,
            keepFailedWorkspaces: config.KEEP_FAILED_WORKSPACES,
          },
        ),
      inject: [
        APP_CONFIG,
        IMPROVEMENT_JOB_REPOSITORY,
        JOB_QUEUE_PORT,
        REPOSITORY_REPOSITORY,
        WORKSPACE_PORT,
        GIT_PORT,
        COVERAGE_RUNNER_PORT,
        AI_TEST_GENERATOR_PORT,
        PULL_REQUEST_PORT,
        LEASE_KEEPER_PORT,
        CLOCK,
        LOGGER_PORT,
      ],
    },
    {
      provide: RecoverStaleJobs,
      useFactory: (
        config: AppConfig,
        queue: JobQueuePort,
        jobs: ImprovementJobRepository,
        repositories: RepositoryRepository,
        clock: Clock,
        logger: LoggerPort,
      ) =>
        new RecoverStaleJobs(queue, jobs, repositories, clock, logger, {
          maxAttempts: config.JOB_MAX_ATTEMPTS,
          maxScanDurationMs: config.maxScanDurationMs,
        }),
      inject: [
        APP_CONFIG,
        JOB_QUEUE_PORT,
        IMPROVEMENT_JOB_REPOSITORY,
        REPOSITORY_REPOSITORY,
        CLOCK,
        LOGGER_PORT,
      ],
    },
  ],
  exports: [
    PersistenceModule,
    AdaptersModule,
    COVERAGE_THRESHOLD,
    RegisterRepository,
    ScanCoverage,
    RequestImprovement,
    GetDashboard,
    ProcessNextJob,
    RecoverStaleJobs,
  ],
})
export class ApplicationModule {}
