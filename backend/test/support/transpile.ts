import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import * as ts from 'typescript';

const SRC = join(__dirname, '..', '..', 'src');

/**
 * Transpiles `src/<subdirs>` to CommonJS in `outDir` (no type-check, very fast) and copies .sql files,
 * so child processes in tests can run the real production code without a build step.
 */
export function transpileSources(outDir: string, subdirs: string[]): void {
  for (const subdir of subdirs) {
    walk(join(SRC, subdir), (file) => {
      const target = join(outDir, relative(SRC, file));
      mkdirSync(dirname(target), { recursive: true });
      if (file.endsWith('.ts')) {
        const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
            experimentalDecorators: true,
          },
        });
        writeFileSync(target.replace(/\.ts$/, '.js'), outputText);
      } else if (file.endsWith('.sql')) {
        cpSync(file, target);
      }
    });
  }
}

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, visit);
    else visit(path);
  }
}
