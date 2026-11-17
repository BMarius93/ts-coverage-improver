import { GitHubRepoUrl } from '../../../src/domain/repository/github-repo-url';
import { repoUrl } from '../../support/builders';

describe('GitHubRepoUrl', () => {
  it.each([
    'https://github.com/acme/widgets',
    'https://github.com/acme/widgets/',
    'https://github.com/acme/widgets.git',
    'git@github.com:acme/widgets.git',
    '  https://github.com/acme/widgets  ',
  ])('parses %p', (value) => {
    const url = repoUrl(value);
    expect(url.owner).toBe('acme');
    expect(url.name).toBe('widgets');
    expect(url.cloneUrl).toBe('https://github.com/acme/widgets.git');
    expect(url.webUrl).toBe('https://github.com/acme/widgets');
    expect(url.toString()).toBe(url.webUrl);
  });

  it.each([
    'http://github.com/acme/widgets',
    'https://gitlab.com/acme/widgets',
    'https://github.com/acme',
    'https://github.com/acme/widgets/tree/main',
    'https://github.com/-acme/widgets',
    'https://github.com/acme/..',
    'https://github.com/acme/name.',
    'https://github.com/acme/wid gets',
    'acme/widgets',
  ])('rejects %p', (value) => {
    expect(GitHubRepoUrl.create(value).ok).toBe(false);
  });

  it('treats owner and name case-insensitively for equality', () => {
    expect(
      repoUrl('https://github.com/Acme/Widgets').equals(repoUrl('https://github.com/acme/widgets')),
    ).toBe(true);
    expect(repoUrl('https://github.com/Acme/Widgets').fullName).toBe('acme/widgets');
  });
});
