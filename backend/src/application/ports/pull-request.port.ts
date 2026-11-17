import { PullRequestUrl } from '../../domain/job/pull-request-url';
import { GitHubRepoUrl } from '../../domain/repository/github-repo-url';

export interface OpenPullRequest {
  repository: GitHubRepoUrl;
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface PullRequestPort {
  /** Opens a PR, or returns the already open PR for the same head branch (idempotent on retry). */
  open(request: OpenPullRequest): Promise<PullRequestUrl>;
}

export const PULL_REQUEST_PORT = Symbol('PullRequestPort');
