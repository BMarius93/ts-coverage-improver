import { FilePath } from '../../../src/domain/coverage/file-path';
import { path } from '../../support/builders';

describe('FilePath', () => {
  it.each(['src/index.ts', 'lib/a/b-c_d.tsx', 'src/@scope/x.ts', 'src/types.d.ts'])('accepts %p', (value) => {
    expect(FilePath.create(value).ok).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['/etc/passwd.ts', 'absolute'],
    ['../outside.ts', 'parent segment'],
    ['src/../../x.ts', 'parent segment in the middle'],
    ['src//a.ts', 'empty segment'],
    ['./src/a.ts', 'dot segment'],
    ['src\\a.ts', 'backslash'],
    ['src/a.js', 'not TypeScript'],
    ['-rf.ts', 'looks like a CLI flag'],
    ['src/a;rm.ts', 'shell metacharacter'],
    ['a'.repeat(501) + '.ts', 'too long'],
  ])('rejects %p (%s)', (value) => {
    expect(FilePath.create(value).ok).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(path('  src/a.ts ').value).toBe('src/a.ts');
  });

  it('recognises test and declaration files', () => {
    expect(path('src/a.test.ts').isTestFile).toBe(true);
    expect(path('src/a.spec.tsx').isTestFile).toBe(true);
    expect(path('src/a.ts').isTestFile).toBe(false);
    expect(path('src/a.d.ts').isDeclarationFile).toBe(true);
  });

  it('derives the sibling test file', () => {
    expect(path('src/utils/date.ts').defaultTestFile().value).toBe('src/utils/date.test.ts');
    expect(path('src/View.tsx').defaultTestFile().value).toBe('src/View.test.tsx');
  });

  it('derives a branch-safe slug', () => {
    expect(path('src/Utils/Date_Parser.ts').slug()).toBe('src-utils-date-parser');
    expect(path('src/a-very-long-directory-name/another-long-file-name.ts').slug(20)).toBe('src-a-very-long-dire');
    expect(path('src/___.ts').slug()).toBe('src');
    expect(path('_.ts').slug()).toBe('file');
  });

  it('compares by value', () => {
    expect(path('src/a.ts').equals(path('src/a.ts'))).toBe(true);
    expect(path('src/a.ts').toString()).toBe('src/a.ts');
  });
});
