import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CoverageReportParser,
  formatLineRanges,
} from '../../../src/infrastructure/coverage/jest/coverage-report-parser';
import { path } from '../../support/builders';

describe('CoverageReportParser', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'parser-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), '');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const counter = (covered: number, total: number) => ({ covered, total, skipped: 0, pct: 0 });

  it('converts the summary into domain coverage with repository-relative paths', () => {
    const parser = new CoverageReportParser(root);
    const files = parser.parseSummary({
      total: {
        lines: counter(1, 2),
        statements: counter(1, 2),
        functions: counter(1, 1),
        branches: counter(0, 0),
      },
      [join(root, 'src', 'a.ts')]: {
        lines: counter(1, 4),
        statements: counter(2, 4),
        functions: counter(0, 1),
        branches: counter(0, 0),
      },
      '/somewhere/else/b.ts': {
        lines: counter(1, 1),
        statements: counter(1, 1),
        functions: counter(1, 1),
        branches: counter(1, 1),
      },
      [join(root, 'src', 'weird;name.ts')]: {
        lines: counter(1, 1),
        statements: counter(1, 1),
        functions: counter(1, 1),
        branches: counter(1, 1),
      },
    });
    expect(files).toHaveLength(1);
    expect(files[0].path.value).toBe('src/a.ts');
    expect(files[0].metrics.lines.value).toBe(25);
    expect(files[0].metrics.statements.value).toBe(50);
    expect(files[0].metrics.functions.value).toBe(0);
    expect(files[0].metrics.branches.value).toBe(100); // nothing to cover
  });

  it('extracts uncovered lines from statement counts', () => {
    const parser = new CoverageReportParser(root);
    const lines = parser.uncoveredLines(
      {
        [join(root, 'src', 'a.ts')]: {
          statementMap: {
            '0': { start: { line: 1 }, end: { line: 1 } },
            '1': { start: { line: 3 }, end: { line: 5 } },
            '2': { start: { line: 9 }, end: { line: 9 } },
          },
          s: { '0': 4, '1': 0, '2': 0 },
        },
      },
      path('src/a.ts'),
    );
    expect(lines).toEqual([3, 4, 5, 9]);
    expect(parser.uncoveredLines({}, path('src/a.ts'))).toEqual([]);
  });

  it('formats line ranges compactly', () => {
    expect(formatLineRanges([1, 2, 3, 7, 9, 10])).toBe('1-3, 7, 9-10');
    expect(formatLineRanges([])).toBe('');
  });
});
