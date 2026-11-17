import { CoverageAnalyzer } from '../../domain/coverage/coverage-analyzer';
import { CoverageThreshold } from '../../domain/coverage/coverage-threshold';
import { GitHubRepoUrl } from '../../domain/repository/github-repo-url';
import { Repository } from '../../domain/repository/repository';
import { RepositoryRepository } from '../../domain/repository/repository-repository';
import { Clock } from '../../domain/shared/clock';
import { ValidationError } from '../../domain/shared/domain-error';
import { IdGenerator } from '../../domain/shared/id-generator';
import { ok, Result } from '../../domain/shared/result';
import { RepositoryView, toRepositoryView } from '../views';

export interface RegisterRepositoryResult {
  repository: RepositoryView;
  created: boolean;
}

/** Registers a GitHub repository. Idempotent: registering the same repository twice returns the first one. */
export class RegisterRepository {
  private readonly analyzer = new CoverageAnalyzer();

  constructor(
    private readonly repositories: RepositoryRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly threshold: CoverageThreshold,
  ) {}

  async execute(input: { url: string }): Promise<Result<RegisterRepositoryResult, ValidationError>> {
    const url = GitHubRepoUrl.create(input.url);
    if (!url.ok) {
      return url;
    }
    const existing = await this.repositories.findByUrl(url.value);
    if (existing) {
      return ok({ repository: this.view(existing), created: false });
    }
    const repository = Repository.register({ id: this.ids.next(), url: url.value, now: this.clock.now() });
    await this.repositories.save(repository);
    return ok({ repository: this.view(repository), created: true });
  }

  private view(repository: Repository): RepositoryView {
    return toRepositoryView(repository, this.threshold, this.analyzer);
  }
}
