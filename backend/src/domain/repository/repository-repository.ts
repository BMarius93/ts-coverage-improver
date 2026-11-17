import { GitHubRepoUrl } from './github-repo-url';
import { Repository } from './repository';

/** Persistence contract for the Repository aggregate (implemented in infrastructure). */
export interface RepositoryRepository {
  save(repository: Repository): Promise<void>;
  findById(id: string): Promise<Repository | null>;
  findByUrl(url: GitHubRepoUrl): Promise<Repository | null>;
  findAll(): Promise<Repository[]>;
}
