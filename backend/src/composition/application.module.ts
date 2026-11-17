import { Module } from '@nestjs/common';
import { CoverageRunnerPort, COVERAGE_RUNNER_PORT } from '../application/ports/coverage-runner.port';
import { GIT_PORT, GitPort } from '../application/ports/git.port';
import { LOGGER_PORT, LoggerPort } from '../application/ports/logger.port';
import { WORKSPACE_PORT, WorkspacePort } from '../application/ports/workspace.port';
import {
  CLOCK,
  ID_GENERATOR,
  IMPROVEMENT_JOB_REPOSITORY,
  REPOSITORY_REPOSITORY,
} from '../application/tokens';
import { GetDashboard } from '../application/use-cases/get-dashboard';
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
        repos: RepositoryRepository,
        jobs: ImprovementJobRepository,
        ids: IdGenerator,
        clock: Clock,
      ) => new RequestImprovement(repos, jobs, ids, clock),
      inject: [REPOSITORY_REPOSITORY, IMPROVEMENT_JOB_REPOSITORY, ID_GENERATOR, CLOCK],
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
  ],
  exports: [
    PersistenceModule,
    AdaptersModule,
    COVERAGE_THRESHOLD,
    RegisterRepository,
    ScanCoverage,
    RequestImprovement,
    GetDashboard,
  ],
})
export class ApplicationModule {}
