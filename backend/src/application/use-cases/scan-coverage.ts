import { CoverageAnalyzer } from '../../domain/coverage/coverage-analyzer';
import { CoverageSnapshot } from '../../domain/coverage/coverage-snapshot';
import { CoverageThreshold } from '../../domain/coverage/coverage-threshold';
import { Repository } from '../../domain/repository/repository';
import { RepositoryRepository } from '../../domain/repository/repository-repository';
import { Clock } from '../../domain/shared/clock';
import { ConflictError } from '../../domain/shared/domain-error';
import { err, ok, Result, unwrap } from '../../domain/shared/result';
import { errorMessage, NotFoundError } from '../errors';
import { CoverageRunnerPort } from '../ports/coverage-runner.port';
import { GitPort } from '../ports/git.port';
import { LoggerPort } from '../ports/logger.port';
import { WorkspacePort } from '../ports/workspace.port';
import { RepositoryView, toRepositoryView } from '../views';

export interface ScanStarted {
  repository: RepositoryView;
  /** Resolves when the background scan has finished (successfully or not). Never rejects. */
  completion: Promise<void>;
}

/**
 * Clones a repository, runs its tests with coverage and stores a CoverageSnapshot.
 *
 * `execute` marks the repository as scanning and returns immediately; the slow part runs in the
 * background and records success or failure on the aggregate. Scans that die with the process are
 * detected as stale by RecoverStaleJobs.
 */
export class ScanCoverage {
  private readonly analyzer = new CoverageAnalyzer();

  constructor(
    private readonly repositories: RepositoryRepository,
    private readonly workspace: WorkspacePort,
    private readonly git: GitPort,
    private readonly coverage: CoverageRunnerPort,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
    private readonly threshold: CoverageThreshold,
  ) {}

  async execute(repositoryId: string): Promise<Result<ScanStarted, NotFoundError | ConflictError>> {
    const repository = await this.repositories.findById(repositoryId);
    if (!repository) {
      return err(new NotFoundError('Repository', repositoryId));
    }
    if (repository.isScanning) {
      return err(new ConflictError(`A scan of ${repository.url.fullName} is already running`));
    }
    repository.startScan(this.clock.now());
    await this.repositories.save(repository);

    const completion = this.run(repository.id);
    return ok({ repository: toRepositoryView(repository, this.threshold, this.analyzer), completion });
  }

  private async run(repositoryId: string): Promise<void> {
    let dir: string | null = null;
    try {
      const repository = await this.load(repositoryId);
      dir = await this.workspace.create('scan', `${repositoryId}-${this.clock.now().getTime()}`);
      await this.git.clone(repository.url, dir);
      const commitSha = await this.git.headCommit(dir);
      const defaultBranch = await this.git.currentBranch(dir);
      await this.coverage.installDependencies(dir);
      const measured = await this.coverage.measureRepository(dir);
      const snapshot = unwrap(
        CoverageSnapshot.create({ commitSha, takenAt: this.clock.now(), files: measured.files }),
      );

      const fresh = await this.load(repositoryId);
      fresh.completeScan({ snapshot, defaultBranch, now: this.clock.now() });
      await this.repositories.save(fresh);
      this.logger.info('Scan completed', {
        repositoryId,
        files: snapshot.files.length,
        testsPassed: measured.testsPassed,
      });
    } catch (error) {
      await this.recordFailure(repositoryId, errorMessage(error));
    } finally {
      if (dir) {
        await this.workspace.remove(dir).catch((error: unknown) => {
          this.logger.warn('Could not remove scan workspace', { dir, error: errorMessage(error) });
        });
      }
    }
  }

  private async recordFailure(repositoryId: string, reason: string): Promise<void> {
    this.logger.warn('Scan failed', { repositoryId, reason });
    try {
      const repository = await this.load(repositoryId);
      if (repository.isScanning) {
        repository.failScan(reason, this.clock.now());
        await this.repositories.save(repository);
      }
    } catch (error) {
      this.logger.error('Could not record scan failure', { repositoryId, error: errorMessage(error) });
    }
  }

  private async load(repositoryId: string): Promise<Repository> {
    const repository = await this.repositories.findById(repositoryId);
    if (!repository) {
      throw new NotFoundError('Repository', repositoryId);
    }
    return repository;
  }
}
