import { mkdir, rm, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { WorkspacePort } from '../../application/ports/workspace.port';

/** Workspaces live under WORKSPACE_DIR/<kind>s/<id>. Removal refuses to touch anything outside the root. */
export class FsWorkspace implements WorkspacePort {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async create(kind: 'scan' | 'job', id: string): Promise<string> {
    const safeId = id.replace(/[^A-Za-z0-9._-]/g, '_');
    if (safeId === '' || safeId === '.' || safeId === '..') {
      throw new Error(`Invalid workspace id: ${id}`);
    }
    const dir = join(this.root, `${kind}s`, safeId);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async remove(dir: string): Promise<void> {
    await rm(this.insideRoot(dir), { recursive: true, force: true });
  }

  async removePaths(dir: string, relativePaths: string[]): Promise<string[]> {
    const base = this.insideRoot(dir);
    const removed: string[] = [];
    for (const path of relativePaths) {
      const target = resolve(base, path);
      if (!target.startsWith(base + sep)) {
        throw new Error(`Refusing to remove ${path}: outside the workspace`);
      }
      const exists = await stat(target).then(
        () => true,
        () => false,
      );
      if (exists) {
        await rm(target, { recursive: true, force: true });
        removed.push(path);
      }
    }
    return removed;
  }

  private insideRoot(dir: string): string {
    const absolute = resolve(dir);
    const rel = relative(this.root, absolute);
    if (rel === '' || rel.startsWith('..') || resolve(this.root, rel) !== absolute) {
      throw new Error(`Refusing to touch ${dir}: outside the workspace root`);
    }
    return absolute;
  }
}
