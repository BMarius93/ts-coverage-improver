import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BACKEND = resolve(__dirname, '..', '..');
const FIXTURE = join(BACKEND, 'test', 'fixtures', 'sample-lib');

export interface FixtureRemote {
  root: string;
  /** Use as GIT_CLONE_BASE_URL: `<base>/acme/sample-lib.git` is the bare repository. */
  cloneBaseUrl: string;
  bareRepo: string;
  /** Use as JEST_COMMAND: the backend's own Jest, since the fixture has no node_modules (no network). */
  jestCommand: string;
  cleanup(): void;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.com',
    },
    stdio: 'pipe',
  }).toString();

/**
 * Builds a local "GitHub" for tests: a bare repository at <root>/remotes/acme/sample-lib.git whose
 * content is test/fixtures/sample-lib plus a jest.config.js pointing at the backend's ts-jest.
 */
export function createFixtureRemote(): FixtureRemote {
  const root = mkdtempSync(join(tmpdir(), 'coverage-improver-remote-'));
  const work = join(root, 'work');
  cpSync(FIXTURE, work, { recursive: true });
  writeFileSync(
    join(work, 'jest.config.js'),
    `module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: { '^.+\\\\.ts$': ${JSON.stringify(require.resolve('ts-jest', { paths: [BACKEND] }))} },
};
`,
  );
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'initial');
  const remotes = join(root, 'remotes', 'acme');
  mkdirSync(remotes, { recursive: true });
  const bareRepo = join(remotes, 'sample-lib.git');
  git(root, 'clone', '-q', '--bare', work, bareRepo);
  return {
    root,
    cloneBaseUrl: `file://${join(root, 'remotes')}`,
    bareRepo,
    jestCommand: join(BACKEND, 'node_modules', '.bin', 'jest'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function gitOutput(cwd: string, ...args: string[]): string {
  return git(cwd, ...args).trim();
}
