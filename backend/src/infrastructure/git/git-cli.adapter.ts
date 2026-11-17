import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { GitPort } from '../../application/ports/git.port';
import { ChangedFile, ChangeKind } from '../../domain/job/improvement-verifier';
import { GitHubRepoUrl } from '../../domain/repository/github-repo-url';
import { childEnv } from '../process/child-env';
import { ProcessResult, runProcessOrThrow } from '../process/run-process';

export interface GitCliOptions {
  token: string | undefined;
  authorName: string;
  authorEmail: string;
  timeoutMs: number;
  /** Base for clone/push URLs; `https://github.com` in production, a file:// URL in tests. */
  cloneBaseUrl: string;
}

/**
 * GitPort on top of the `git` CLI.
 *
 * The token never appears in argv (visible in `ps`), in the remote URL or in `.git/config`: it is passed
 * per invocation through GIT_CONFIG_COUNT/KEY/VALUE environment variables as an `http.extraHeader` that
 * is scoped to https://github.com/, and only for commands that talk to the remote (clone, push).
 */
export class GitCliAdapter implements GitPort {
  constructor(private readonly options: GitCliOptions) {}

  async clone(repository: GitHubRepoUrl, dir: string): Promise<void> {
    await this.git(
      dir,
      ['clone', '--depth', '1', '--no-tags', '--single-branch', '--', this.remoteUrl(repository), '.'],
      {
        authenticated: true,
      },
    );
  }

  async headCommit(dir: string): Promise<string> {
    return (await this.git(dir, ['rev-parse', 'HEAD'])).stdout.trim();
  }

  async currentBranch(dir: string): Promise<string> {
    return (await this.git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  }

  async createBranch(dir: string, branch: string): Promise<void> {
    await this.git(dir, ['check-ref-format', '--branch', branch]);
    await this.git(dir, ['checkout', '-b', branch]);
  }

  async changedFiles(dir: string): Promise<ChangedFile[]> {
    const { stdout } = await this.git(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    return parsePorcelain(stdout);
  }

  async restoreNonTestChanges(dir: string, keep: (path: string) => boolean): Promise<string[]> {
    const reverted: string[] = [];
    for (const file of await this.changedFiles(dir)) {
      if (keep(file.path)) continue;
      if (file.kind === 'modified' || file.kind === 'deleted') {
        // From HEAD, so staged changes are undone as well.
        await this.git(dir, ['checkout', 'HEAD', '--', file.path]);
      } else {
        // added (untracked or staged) or the new side of a rename: drop it from the index and the disk
        await this.git(dir, ['rm', '-q', '-r', '--cached', '--ignore-unmatch', '--', file.path]);
        await rm(insideRepository(dir, file.path), { recursive: true, force: true });
        if (file.kind === 'renamed' && file.from && !keep(file.from)) {
          await this.git(dir, ['checkout', 'HEAD', '--', file.from]);
        }
      }
      reverted.push(file.path);
    }
    return reverted;
  }

  async commit(dir: string, files: string[], message: string): Promise<void> {
    if (files.length === 0) {
      throw new Error('Nothing to commit');
    }
    await this.git(dir, ['add', '--', ...files]);
    await this.git(dir, ['commit', '--no-verify', '-m', message]);
  }

  async push(dir: string, repository: GitHubRepoUrl, branch: string): Promise<void> {
    // --force: the branch is owned by this job (its name contains the job id); a retried job overwrites
    // whatever a crashed previous attempt pushed.
    await this.git(dir, ['push', '--force', this.remoteUrl(repository), `HEAD:refs/heads/${branch}`], {
      authenticated: true,
    });
  }

  private remoteUrl(repository: GitHubRepoUrl): string {
    return `${this.options.cloneBaseUrl.replace(/\/$/, '')}/${repository.owner}/${repository.name}.git`;
  }

  private git(
    dir: string,
    args: string[],
    options: { authenticated?: boolean } = {},
  ): Promise<ProcessResult> {
    const auth: Record<string, string> = {};
    if (options.authenticated && this.options.token) {
      const basic = Buffer.from(`x-access-token:${this.options.token}`).toString('base64');
      auth.GIT_CONFIG_COUNT = '1';
      auth.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
      auth.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
    }
    return runProcessOrThrow('git', args, {
      cwd: dir,
      timeoutMs: this.options.timeoutMs,
      env: childEnv({
        ...auth,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
        GIT_AUTHOR_NAME: this.options.authorName,
        GIT_AUTHOR_EMAIL: this.options.authorEmail,
        GIT_COMMITTER_NAME: this.options.authorName,
        GIT_COMMITTER_EMAIL: this.options.authorEmail,
      }),
    });
  }
}

/** Parses `git status --porcelain=v1 -z`. Renames carry an extra NUL-separated "from" path. */
export function parsePorcelain(output: string): ChangedFile[] {
  const entries = output.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    let kind: ChangeKind;
    if (status === '??' || status.includes('A')) {
      kind = 'added';
    } else if (status.includes('D')) {
      kind = 'deleted';
    } else if (status.includes('R')) {
      files.push({ path, kind: 'renamed', from: entries[++i] });
      continue;
    } else {
      kind = 'modified';
    }
    files.push({ path, kind });
  }
  return files;
}

function insideRepository(dir: string, path: string): string {
  const root = resolve(dir);
  const target = resolve(root, path);
  if (!target.startsWith(root + sep)) {
    throw new Error(`Refusing to touch ${path}: outside the repository`);
  }
  return target;
}
