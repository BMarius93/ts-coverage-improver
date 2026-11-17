import { CoverageAnalyzer } from '../../domain/coverage/coverage-analyzer';
import { CoverageThreshold } from '../../domain/coverage/coverage-threshold';
import { ImprovementJob } from '../../domain/job/improvement-job';
import { ImprovementJobRepository } from '../../domain/job/improvement-job-repository';
import { RepositoryRepository } from '../../domain/repository/repository-repository';
import { err, ok, Result } from '../../domain/shared/result';
import { NotFoundError } from '../errors';
import { FileView, JobView, RepositoryView, toFileView, toJobView, toRepositoryView } from '../views';

export interface RepositoryDetailsView {
  repository: RepositoryView;
  files: FileView[];
}

/** Read side for the dashboard: repositories, their files with coverage, and jobs. */
export class GetDashboard {
  private readonly analyzer = new CoverageAnalyzer();

  constructor(
    private readonly repositories: RepositoryRepository,
    private readonly jobs: ImprovementJobRepository,
    private readonly threshold: CoverageThreshold,
  ) {}

  async listRepositories(): Promise<RepositoryView[]> {
    const repositories = await this.repositories.findAll();
    return repositories.map((repository) => toRepositoryView(repository, this.threshold, this.analyzer));
  }

  async getRepository(id: string): Promise<Result<RepositoryView, NotFoundError>> {
    const repository = await this.repositories.findById(id);
    if (!repository) {
      return err(new NotFoundError('Repository', id));
    }
    return ok(toRepositoryView(repository, this.threshold, this.analyzer));
  }

  /**
   * Files of the latest snapshot with the latest job of each. With `belowThresholdOnly` the list is what the
   * analyzer recommends (lowest coverage first) followed by the below-threshold files it skipped, so the UI
   * can say why they are not offered; otherwise all files sorted by path.
   */
  async listFiles(
    id: string,
    options: { belowThresholdOnly: boolean },
  ): Promise<Result<FileView[], NotFoundError>> {
    const repository = await this.repositories.findById(id);
    if (!repository) {
      return err(new NotFoundError('Repository', id));
    }
    const snapshot = repository.latestSnapshot;
    if (!snapshot) {
      return ok([]);
    }
    const latestJobByFile = new Map<string, ImprovementJob>();
    for (const job of await this.jobs.findByRepository(id)) {
      if (!latestJobByFile.has(job.targetFile.value)) {
        latestJobByFile.set(job.targetFile.value, job);
      }
    }
    const analysis = this.analyzer.analyze(snapshot, this.threshold);
    const files = options.belowThresholdOnly
      ? [...analysis.candidates, ...analysis.skipped.map((skipped) => skipped.file)]
      : snapshot.files;
    return ok(
      files.map((file) =>
        toFileView(
          file,
          !this.threshold.isMetBy(file.lines),
          this.analyzer.skipReason(file),
          latestJobByFile.get(file.path.value) ?? null,
        ),
      ),
    );
  }

  async listJobs(repositoryId: string): Promise<Result<JobView[], NotFoundError>> {
    const repository = await this.repositories.findById(repositoryId);
    if (!repository) {
      return err(new NotFoundError('Repository', repositoryId));
    }
    return ok((await this.jobs.findByRepository(repositoryId)).map(toJobView));
  }

  async getJob(id: string): Promise<Result<JobView, NotFoundError>> {
    const job = await this.jobs.findById(id);
    return job ? ok(toJobView(job)) : err(new NotFoundError('Job', id));
  }
}
