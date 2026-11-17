import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SourceFileClassifier } from '../../../src/infrastructure/coverage/source-file-classifier';

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'source-files');

describe('SourceFileClassifier', () => {
  const classifier = new SourceFileClassifier();
  const classify = (fixture: string) =>
    classifier.classify(fixture, readFileSync(join(FIXTURES, fixture), 'utf8'));

  it.each([
    [
      'pure-barrel.ts',
      're-export-only',
      'export *, export * as, export { a, b as c }, default re-export, comments',
    ],
    [
      'type-only-reexports.ts',
      're-export-only',
      'export type { T } from, export type * from, inline type specifier',
    ],
    ['barrel.tsx', 're-export-only', 'TSX barrel'],
    ['barrel-with-function.ts', 'module', 're-exports plus one function'],
    ['export-const.ts', 'module', 'export const x = 1'],
    ['local-reexport.ts', 'module', 'import + export { x } without from'],
    ['comments-only.ts', 'module', 'comments only (re-exports nothing)'],
    ['empty.ts', 'module', 'empty file'],
    ['broken.ts', 'module', 'syntax error falls back to module'],
  ])('%s -> %s (%s)', (fixture, kind) => {
    expect(classify(fixture)).toBe(kind);
  });
});
