import { Module } from '@nestjs/common';
import { AI_TEST_GENERATOR_PORT } from '../application/ports/ai-test-generator.port';
import { COVERAGE_RUNNER_PORT } from '../application/ports/coverage-runner.port';
import { GIT_PORT } from '../application/ports/git.port';
import { JOB_QUEUE_PORT, JobQueuePort } from '../application/ports/job-queue.port';
import { LEASE_KEEPER_PORT } from '../application/ports/lease-keeper.port';
import { LOGGER_PORT, LoggerPort } from '../application/ports/logger.port';
import { PULL_REQUEST_PORT } from '../application/ports/pull-request.port';
import { WORKSPACE_PORT } from '../application/ports/workspace.port';
import { ClaudeCliAdapter } from '../infrastructure/ai/claude/claude-cli.adapter';
import { APP_CONFIG, AppConfig } from '../infrastructure/config/app-config';
import {
  OctokitPullRequestAdapter,
  octokitPullsFactory,
} from '../infrastructure/github/octokit-pull-request.adapter';
import { IntervalLeaseKeeper } from '../infrastructure/worker/interval-lease-keeper';
import { PersistenceModule } from './persistence.module';
import { JestCoverageRunner } from '../infrastructure/coverage/jest/jest-coverage-runner';
import { GitCliAdapter } from '../infrastructure/git/git-cli.adapter';
import { NestLoggerAdapter } from '../infrastructure/logging/nest-logger.adapter';
import { FsWorkspace } from '../infrastructure/workspace/fs-workspace';

/** Binds infrastructure adapters to application ports. */
@Module({
  imports: [PersistenceModule],
  providers: [
    { provide: LOGGER_PORT, useFactory: () => new NestLoggerAdapter('CoverageImprover') },
    {
      provide: WORKSPACE_PORT,
      useFactory: (config: AppConfig) => new FsWorkspace(config.workspaceDir),
      inject: [APP_CONFIG],
    },
    {
      provide: GIT_PORT,
      useFactory: (config: AppConfig) =>
        new GitCliAdapter({
          token: config.GITHUB_TOKEN,
          authorName: config.GIT_AUTHOR_NAME,
          authorEmail: config.GIT_AUTHOR_EMAIL,
          timeoutMs: config.PROCESS_TIMEOUT_MS,
          cloneBaseUrl: config.GIT_CLONE_BASE_URL,
        }),
      inject: [APP_CONFIG],
    },
    {
      provide: COVERAGE_RUNNER_PORT,
      useFactory: (config: AppConfig) =>
        new JestCoverageRunner({
          jestCommand: config.JEST_COMMAND,
          sourceGlob: config.COVERAGE_SOURCE_GLOB,
          timeoutMs: config.PROCESS_TIMEOUT_MS,
        }),
      inject: [APP_CONFIG],
    },
    {
      provide: AI_TEST_GENERATOR_PORT,
      useFactory: (config: AppConfig, logger: LoggerPort) =>
        new ClaudeCliAdapter(
          {
            cliPath: config.AI_CLI_PATH,
            plannerModel: config.AI_PLANNER_MODEL,
            writerModel: config.AI_WRITER_MODEL,
            plannerMaxTurns: config.AI_PLANNER_MAX_TURNS,
            writerMaxTurns: config.AI_WRITER_MAX_TURNS,
            maxBudgetUsd: config.AI_MAX_BUDGET_USD,
            timeoutMs: config.AI_TIMEOUT_MS,
          },
          logger,
        ),
      inject: [APP_CONFIG, LOGGER_PORT],
    },
    {
      provide: PULL_REQUEST_PORT,
      useFactory: (config: AppConfig) =>
        new OctokitPullRequestAdapter(octokitPullsFactory(config.GITHUB_TOKEN, 'ts-coverage-improver')),
      inject: [APP_CONFIG],
    },
    {
      provide: LEASE_KEEPER_PORT,
      useFactory: (config: AppConfig, queue: JobQueuePort, logger: LoggerPort) =>
        new IntervalLeaseKeeper(queue, config.JOB_LEASE_SECONDS * 1000, logger),
      inject: [APP_CONFIG, JOB_QUEUE_PORT, LOGGER_PORT],
    },
  ],
  exports: [
    LOGGER_PORT,
    WORKSPACE_PORT,
    GIT_PORT,
    COVERAGE_RUNNER_PORT,
    AI_TEST_GENERATOR_PORT,
    PULL_REQUEST_PORT,
    LEASE_KEEPER_PORT,
  ],
})
export class AdaptersModule {}
