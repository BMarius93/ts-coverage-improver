import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import { FilePath } from '../../../domain/coverage/file-path';

const TEST_FILE = /\.(test|spec)\.tsx?$/;
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out']);
const MAX_EXISTING = 5;
const MAX_STYLE_LINES = 120;
/** Bounds the walk in large repositories; the example only needs to be representative. */
const MAX_FILES_VISITED = 5000;

/** Finds test files the AI should know about. Read-only, bounded, never follows node_modules. */
export class TestFileScanner {
  /**
   * Test files next to the target and in a sibling `__tests__` folder; files named after the target first.
   * Paths are repo-relative, at most five.
   */
  async existingTestFiles(root: string, target: FilePath): Promise<string[]> {
    const dir = posix.dirname(target.value);
    const stem = basename(target.value).replace(/\.tsx?$/, '');
    const candidates: string[] = [];
    for (const folder of [dir, posix.join(dir, '__tests__')]) {
      for (const name of await listFiles(join(root, folder))) {
        if (/\.test\.tsx?$/.test(name)) candidates.push(folder === '.' ? name : `${folder}/${name}`);
      }
    }
    const ownFirst = (path: string) => (basename(path).startsWith(`${stem}.`) ? 0 : 1);
    return candidates.sort((a, b) => ownFirst(a) - ownFirst(b) || a.localeCompare(b)).slice(0, MAX_EXISTING);
  }

  /** Content of the shortest real test file (one that calls `it(` or `test(`), cut to 120 lines. */
  async styleExample(root: string): Promise<string | null> {
    let best: { path: string; size: number } | null = null;
    let visited = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++visited > MAX_FILES_VISITED) return;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(path);
        } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
          const { size } = await stat(path);
          if ((best === null || size < best.size) && /\b(it|test)\s*\(/.test(await readFile(path, 'utf8'))) {
            best = { path, size };
          }
        }
      }
    };
    await walk(root);
    if (best === null) return null;
    const lines = (await readFile((best as { path: string }).path, 'utf8')).split('\n');
    return lines.length > MAX_STYLE_LINES
      ? [...lines.slice(0, MAX_STYLE_LINES), '// … (truncated)'].join('\n')
      : lines.join('\n').trimEnd();
  }
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
