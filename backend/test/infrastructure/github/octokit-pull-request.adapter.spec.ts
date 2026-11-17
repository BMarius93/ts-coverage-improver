import {
  GitHubPullsApi,
  OctokitPullRequestAdapter,
  octokitPullsFactory,
} from '../../../src/infrastructure/github/octokit-pull-request.adapter';
import { repoUrl } from '../../support/builders';

const request = {
  repository: repoUrl('https://github.com/acme/widgets'),
  head: 'coverage/src-price-abc12345',
  base: 'main',
  title: 'test: improve coverage',
  body: 'body',
};

function fakePulls(existing: string[] = []) {
  const api = {
    list: jest.fn<ReturnType<GitHubPullsApi['list']>, Parameters<GitHubPullsApi['list']>>(async () => ({
      data: existing.map((html_url) => ({ html_url })),
    })),
    create: jest.fn<ReturnType<GitHubPullsApi['create']>, Parameters<GitHubPullsApi['create']>>(async () => ({
      data: { html_url: 'https://github.com/acme/widgets/pull/12' },
    })),
  };
  return api;
}

describe('OctokitPullRequestAdapter', () => {
  it('creates a pull request', async () => {
    const pulls = fakePulls();
    const url = await new OctokitPullRequestAdapter(async () => pulls).open(request);
    expect(url.value).toBe('https://github.com/acme/widgets/pull/12');
    expect(pulls.list).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      head: 'acme:coverage/src-price-abc12345',
      state: 'open',
      per_page: 1,
    });
    expect(pulls.create).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      head: 'coverage/src-price-abc12345',
      base: 'main',
      title: 'test: improve coverage',
      body: 'body',
      maintainer_can_modify: true,
    });
  });

  it('returns the existing open PR for the branch instead of creating a duplicate (retry safety)', async () => {
    const pulls = fakePulls(['https://github.com/acme/widgets/pull/5']);
    const url = await new OctokitPullRequestAdapter(async () => pulls).open(request);
    expect(url.number).toBe(5);
    expect(pulls.create).not.toHaveBeenCalled();
  });

  it('propagates GitHub errors', async () => {
    const pulls = fakePulls();
    pulls.create.mockRejectedValueOnce(new Error('Validation Failed: No commits between main and branch'));
    await expect(new OctokitPullRequestAdapter(async () => pulls).open(request)).rejects.toThrow(
      /No commits/,
    );
  });

  it('refuses to run without a token', async () => {
    await expect(octokitPullsFactory(undefined, 'ua')()).rejects.toThrow('GITHUB_TOKEN is not configured');
  });
});
