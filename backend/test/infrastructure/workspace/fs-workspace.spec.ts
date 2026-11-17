import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsWorkspace } from '../../../src/infrastructure/workspace/fs-workspace';

describe('FsWorkspace', () => {
  let root: string;
  let workspace: FsWorkspace;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ws-'));
    workspace = new FsWorkspace(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('creates a fresh empty directory per kind and id', async () => {
    const dir = await workspace.create('job', 'abc');
    expect(dir).toBe(join(root, 'jobs', 'abc'));
    writeFileSync(join(dir, 'left-over'), 'x');
    await workspace.create('job', 'abc');
    expect(existsSync(join(dir, 'left-over'))).toBe(false);
  });

  it('sanitises ids', async () => {
    expect(await workspace.create('scan', '../../etc')).toBe(join(root, 'scans', '.._.._etc'));
    await expect(workspace.create('scan', '..')).rejects.toThrow(/Invalid workspace id/);
  });

  it('removes hardening paths that exist and reports them', async () => {
    const dir = await workspace.create('job', 'j1');
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'settings.json'), '{}');
    writeFileSync(join(dir, 'CLAUDE.md'), '# evil instructions');
    expect(await workspace.removePaths(dir, ['.claude', 'CLAUDE.md', 'CLAUDE.local.md'])).toEqual([
      '.claude',
      'CLAUDE.md',
    ]);
    expect(existsSync(join(dir, '.claude'))).toBe(false);
    await expect(workspace.removePaths(dir, ['../other'])).rejects.toThrow(/outside the workspace/);
  });

  it('refuses to remove anything outside its root', async () => {
    await expect(workspace.remove(tmpdir())).rejects.toThrow(/outside the workspace root/);
    await expect(workspace.remove(root)).rejects.toThrow(/outside the workspace root/);
    const dir = await workspace.create('job', 'gone');
    await workspace.remove(dir);
    expect(existsSync(dir)).toBe(false);
  });
});
