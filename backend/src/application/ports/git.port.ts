import { ChangedFile } from '../../domain/job/improvement-verifier';
import { GitHubRepoUrl } from '../../domain/repository/github-repo-url';

/** Git operations on a local working copy. Authentication is the adapter's concern. */
export interface GitPort {
  /** Shallow-clones the default branch of `repository` into the empty directory `dir`. */
  clone(repository: GitHubRepoUrl, dir: string): Promise<void>;
  headCommit(dir: string): Promise<string>;
  currentBranch(dir: string): Promise<string>;
  createBranch(dir: string, branch: string): Promise<void>;
  /** Uncommitted changes, including untracked files. */
  changedFiles(dir: string): Promise<ChangedFile[]>;
  /** Stages exactly `files` (never `git add -A`) and commits them. */
  commit(dir: string, files: string[], message: string): Promise<void>;
  push(dir: string, repository: GitHubRepoUrl, branch: string): Promise<void>;
}

export const GIT_PORT = Symbol('GitPort');
