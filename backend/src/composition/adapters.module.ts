import { Module } from '@nestjs/common';
import { COVERAGE_RUNNER_PORT } from '../application/ports/coverage-runner.port';
import { GIT_PORT } from '../application/ports/git.port';
import { LOGGER_PORT } from '../application/ports/logger.port';
import { WORKSPACE_PORT } from '../application/ports/workspace.port';
import { APP_CONFIG, AppConfig } from '../infrastructure/config/app-config';
import { JestCoverageRunner } from '../infrastructure/coverage/jest/jest-coverage-runner';
import { GitCliAdapter } from '../infrastructure/git/git-cli.adapter';
import { NestLoggerAdapter } from '../infrastructure/logging/nest-logger.adapter';
import { FsWorkspace } from '../infrastructure/workspace/fs-workspace';

/** Binds infrastructure adapters to application ports. */
@Module({
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
  ],
  exports: [LOGGER_PORT, WORKSPACE_PORT, GIT_PORT, COVERAGE_RUNNER_PORT],
})
export class AdaptersModule {}
