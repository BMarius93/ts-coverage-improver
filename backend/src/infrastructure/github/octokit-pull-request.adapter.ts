import { OpenPullRequest, PullRequestPort } from '../../application/ports/pull-request.port';
import { PullRequestUrl } from '../../domain/job/pull-request-url';
import { unwrap } from '../../domain/shared/result';

/** The two Octokit calls we use; lets tests substitute a fake without loading Octokit. */
export interface GitHubPullsApi {
  list(params: {
    owner: string;
    repo: string;
    head: string;
    state: 'open';
    per_page: number;
  }): Promise<{ data: Array<{ html_url: string }> }>;
  create(params: {
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
    maintainer_can_modify: boolean;
  }): Promise<{ data: { html_url: string } }>;
}

/**
 * Opens pull requests with Octokit. Idempotent: if an open PR for the same head branch already exists
 * (e.g. a retried job crashed after creating it), that PR is returned instead of failing with 422.
 */
export class OctokitPullRequestAdapter implements PullRequestPort {
  constructor(private readonly pulls: () => Promise<GitHubPullsApi>) {}

  async open(request: OpenPullRequest): Promise<PullRequestUrl> {
    const pulls = await this.pulls();
    const { owner, name: repo } = request.repository;
    const existing = await pulls.list({
      owner,
      repo,
      head: `${owner}:${request.head}`,
      state: 'open',
      per_page: 1,
    });
    if (existing.data.length > 0) {
      return unwrap(PullRequestUrl.create(existing.data[0].html_url));
    }
    const created = await pulls.create({
      owner,
      repo,
      head: request.head,
      base: request.base,
      title: request.title,
      body: request.body,
      maintainer_can_modify: true,
    });
    return unwrap(PullRequestUrl.create(created.data.html_url));
  }
}

/**
 * Lazily creates the Octokit client. `@octokit/rest` is ESM-only; Node >= 22.12 can `require()` it, and
 * loading it lazily keeps it out of unit tests (Jest's CommonJS runtime cannot load ESM).
 */
export function octokitPullsFactory(
  token: string | undefined,
  userAgent: string,
): () => Promise<GitHubPullsApi> {
  let pulls: GitHubPullsApi | undefined;
  return async () => {
    if (!token) {
      throw new Error('GITHUB_TOKEN is not configured; cannot open a pull request');
    }
    if (!pulls) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Octokit } = require('@octokit/rest') as typeof import('@octokit/rest');
      pulls = new Octokit({ auth: token, userAgent, request: { timeout: 30_000 } }).rest.pulls;
    }
    return Promise.resolve(pulls);
  };
}
