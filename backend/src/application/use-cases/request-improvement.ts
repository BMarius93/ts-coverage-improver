import { FilePath } from '../../domain/coverage/file-path';
import { ImprovementJob } from '../../domain/job/improvement-job';
import { ImprovementJobRepository } from '../../domain/job/improvement-job-repository';
import { JobSchedulingPolicy } from '../../domain/job/job-scheduling-policy';
import { RepositoryRepository } from '../../domain/repository/repository-repository';
import { Clock } from '../../domain/shared/clock';
import { ConflictError, ValidationError } from '../../domain/shared/domain-error';
import { IdGenerator } from '../../domain/shared/id-generator';
import { err, ok, Result } from '../../domain/shared/result';
import { NotFoundError } from '../errors';
import { JobView, toJobView } from '../views';

export type RequestImprovementError = ValidationError | NotFoundError | ConflictError;

/** Queues an improvement job for one file of the latest snapshot. */
export class RequestImprovement {
  private readonly policy = new JobSchedulingPolicy();

  constructor(
    private readonly repositories: RepositoryRepository,
    private readonly jobs: ImprovementJobRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    repositoryId: string;
    filePath: string;
  }): Promise<Result<JobView, RequestImprovementError>> {
    const targetFile = FilePath.create(input.filePath);
    if (!targetFile.ok) {
      return targetFile;
    }
    if (targetFile.value.isTestFile || targetFile.value.isDeclarationFile) {
      return err(new ValidationError(`Cannot improve a test or declaration file: ${targetFile.value.value}`));
    }
    const repository = await this.repositories.findById(input.repositoryId);
    if (!repository) {
      return err(new NotFoundError('Repository', input.repositoryId));
    }
    const snapshot = repository.latestSnapshot;
    if (!snapshot) {
      return err(new ConflictError('Scan the repository before requesting improvements'));
    }
    if (!snapshot.fileFor(targetFile.value)) {
      return err(new NotFoundError('File in latest coverage snapshot', targetFile.value.value));
    }

    const active = await this.jobs.findActiveByRepository(repository.id);
    const allowed = this.policy.canRequest(targetFile.value, active);
    if (!allowed.ok) {
      return allowed;
    }

    const job = ImprovementJob.request({
      id: this.ids.next(),
      repositoryId: repository.id,
      targetFile: targetFile.value,
      now: this.clock.now(),
    });
    await this.jobs.save(job);
    return ok(toJobView(job));
  }
}
