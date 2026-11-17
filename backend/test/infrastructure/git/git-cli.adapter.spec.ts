import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitCliAdapter, parsePorcelain } from '../../../src/infrastructure/git/git-cli.adapter';
import { repoUrl } from '../../support/builders';
import { createFixtureRemote, FixtureRemote, gitOutput } from '../../support/fixture-remote';

describe('GitCliAdapter (against a local bare repository)', () => {
  jest.setTimeout(30_000);
  let remote: FixtureRemote;
  let dir: string;
  let git: GitCliAdapter;
  const repository = repoUrl('https://github.com/acme/sample-lib');

  beforeAll(() => {
    remote = createFixtureRemote();
  });
  afterAll(() => remote.cleanup());
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clone-'));
    git = new GitCliAdapter({
      token: 'ghp_test_token_never_persisted',
      authorName: 'Bot',
      authorEmail: 'bot@example.com',
      timeoutMs: 20_000,
      cloneBaseUrl: remote.cloneBaseUrl,
    });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('clones, reports HEAD and the default branch, and never stores the token', async () => {
    await git.clone(repository, dir);
    expect(await git.headCommit(dir)).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.currentBranch(dir)).toBe('main');
    const config = readFileSync(join(dir, '.git', 'config'), 'utf8');
    expect(config).not.toContain('ghp_test_token');
    expect(config).not.toMatch(/extraheader/i);
  });

  it('creates a branch, lists changes, commits only the given files and pushes', async () => {
    await git.clone(repository, dir);
    await git.createBranch(dir, 'coverage/src-math-abc12345');
    writeFileSync(join(dir, 'src', 'strings.test.ts'), 'it("x", () => {});\n');
    writeFileSync(join(dir, 'src', 'math.ts'), '// modified\n');
    unlinkSync(join(dir, 'CLAUDE.md'));

    expect(await git.changedFiles(dir)).toEqual(
      expect.arrayContaining([
        { path: 'src/strings.test.ts', kind: 'added' },
        { path: 'src/math.ts', kind: 'modified' },
        { path: 'CLAUDE.md', kind: 'deleted' },
      ]),
    );

    await git.commit(dir, ['src/strings.test.ts'], 'test: add strings tests');
    await git.push(dir, repository, 'coverage/src-math-abc12345');

    const pushed = gitOutput(
      remote.bareRepo,
      'show',
      '--name-only',
      '--format=%an|%s',
      'coverage/src-math-abc12345',
    );
    expect(pushed.split('\n')).toEqual(['Bot|test: add strings tests', '', 'src/strings.test.ts']);
    // Untouched working-tree changes were not committed.
    expect((await git.changedFiles(dir)).map((f) => f.path).sort()).toEqual(['CLAUDE.md', 'src/math.ts']);
  });

  it('rejects invalid branch names and empty commits', async () => {
    await git.clone(repository, dir);
    await expect(git.createBranch(dir, 'bad..name')).rejects.toThrow();
    await expect(git.commit(dir, [], 'nothing')).rejects.toThrow('Nothing to commit');
  });

  it('fails clearly when the repository does not exist', async () => {
    await expect(git.clone(repoUrl('https://github.com/acme/missing'), dir)).rejects.toThrow(/git clone/);
  });
});

describe('parsePorcelain', () => {
  it('parses added, untracked, modified, deleted and renamed entries', () => {
    const output = [
      'A  src/a.test.ts',
      '?? src/b.test.ts',
      ' M src/c.ts',
      ' D CLAUDE.md',
      'R  src/new.ts',
      'src/old.ts',
      '',
    ].join('\0');
    expect(parsePorcelain(output)).toEqual([
      { path: 'src/a.test.ts', kind: 'added' },
      { path: 'src/b.test.ts', kind: 'added' },
      { path: 'src/c.ts', kind: 'modified' },
      { path: 'CLAUDE.md', kind: 'deleted' },
      { path: 'src/new.ts', kind: 'renamed' },
    ]);
  });
});
