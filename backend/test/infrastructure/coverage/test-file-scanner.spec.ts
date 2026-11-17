import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TestFileScanner } from '../../../src/infrastructure/coverage/jest/test-file-scanner';
import { path } from '../../support/builders';

describe('TestFileScanner', () => {
  let root: string;
  const scanner = new TestFileScanner();
  const write = (file: string, content: string) => {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), content);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'scanner-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists test files next to the target and in __tests__, own tests first, at most five', async () => {
    write('src/price.ts', '');
    for (const name of ['a', 'b', 'c', 'd']) write(`src/${name}.test.ts`, '');
    write('src/price.test.ts', '');
    write('src/__tests__/price.edge.test.ts', '');
    write('src/price.spec.ts', ''); // not *.test.ts
    write('other/x.test.ts', ''); // elsewhere
    expect(await scanner.existingTestFiles(root, path('src/price.ts'))).toEqual([
      'src/__tests__/price.edge.test.ts',
      'src/price.test.ts',
      'src/a.test.ts',
      'src/b.test.ts',
      'src/c.test.ts',
    ]);
    expect(await scanner.existingTestFiles(root, path('lib/none.ts'))).toEqual([]);
  });

  it('works for files at the repository root', async () => {
    write('index.test.ts', '');
    expect(await scanner.existingTestFiles(root, path('index.ts'))).toEqual(['index.test.ts']);
  });

  it('picks the shortest real test file as style example, skipping node_modules', async () => {
    write('node_modules/lib/tiny.test.ts', "it('x', () => {});");
    write('src/empty.test.ts', '// nothing here');
    write('src/short.test.ts', "import { a } from './a';\n\nit('works', () => expect(a).toBe(1));\n");
    write('src/long.test.ts', `describe('long', () => {\n${"  it('x', () => {});\n".repeat(20)}});\n`);
    expect(await scanner.styleExample(root)).toBe(
      "import { a } from './a';\n\nit('works', () => expect(a).toBe(1));",
    );
  });

  it('truncates the example to 120 lines and returns null without tests', async () => {
    expect(await scanner.styleExample(root)).toBeNull();
    write('src/big.test.ts', `${"it('x', () => {});\n".repeat(200)}`);
    const example = (await scanner.styleExample(root))!.split('\n');
    expect(example).toHaveLength(121);
    expect(example.at(-1)).toBe('// … (truncated)');
  });
});
