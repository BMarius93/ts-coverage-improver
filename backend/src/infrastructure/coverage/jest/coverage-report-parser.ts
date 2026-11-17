import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { CoveragePercentage } from '../../../domain/coverage/coverage-percentage';
import { FileCoverage } from '../../../domain/coverage/file-coverage';
import { FilePath } from '../../../domain/coverage/file-path';

interface Counter {
  total: number;
  covered: number;
}

interface SummaryEntry {
  lines: Counter;
  statements: Counter;
  functions: Counter;
  branches: Counter;
}

/** `coverage-summary.json` (json-summary reporter): absolute file path -> counters, plus "total". */
export type CoverageSummaryJson = Record<string, SummaryEntry>;

interface FinalEntry {
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  s: Record<string, number>;
}

/** `coverage-final.json` (json reporter): istanbul file coverage keyed by absolute path. */
export type CoverageFinalJson = Record<string, FinalEntry>;

const percentage = (counter: Counter | undefined): CoveragePercentage => {
  if (!counter) return CoveragePercentage.zero();
  const result = CoveragePercentage.fromCounts(counter.covered, counter.total);
  return result.ok ? result.value : CoveragePercentage.zero();
};

/**
 * Converts Jest/istanbul reports into domain objects. Paths are made relative to the repository root
 * (resolving symlinks such as macOS /var -> /private/var); files outside the root or with paths the
 * domain rejects are skipped.
 */
export class CoverageReportParser {
  private readonly root: string;

  constructor(repositoryRoot: string) {
    this.root = realpathSync(repositoryRoot);
  }

  parseSummary(summary: CoverageSummaryJson): FileCoverage[] {
    const files: FileCoverage[] = [];
    for (const [absolutePath, entry] of Object.entries(summary)) {
      if (absolutePath === 'total') continue;
      const path = this.toFilePath(absolutePath);
      if (!path) continue;
      files.push(
        new FileCoverage(path, {
          lines: percentage(entry.lines),
          branches: percentage(entry.branches),
          functions: percentage(entry.functions),
          statements: percentage(entry.statements),
        }),
      );
    }
    return files;
  }

  /** Line numbers that contain at least one statement that never ran. */
  uncoveredLines(finalReport: CoverageFinalJson, target: FilePath): number[] {
    const entry = Object.entries(finalReport).find(([file]) => this.toFilePath(file)?.equals(target))?.[1];
    if (!entry) return [];
    const lines = new Set<number>();
    for (const [id, count] of Object.entries(entry.s)) {
      const location = entry.statementMap[id];
      if (count === 0 && location) {
        for (let line = location.start.line; line <= location.end.line; line++) lines.add(line);
      }
    }
    return [...lines].sort((a, b) => a - b);
  }

  private toFilePath(file: string): FilePath | null {
    if (!isAbsolute(file)) return null;
    let real: string;
    try {
      real = realpathSync(file);
    } catch {
      real = file;
    }
    const rel = relative(this.root, real);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
    const result = FilePath.create(rel.split(sep).join('/'));
    return result.ok ? result.value : null;
  }
}

/** Compresses [1,2,3,7,9,10] into "1-3, 7, 9-10" for prompts and logs. */
export function formatLineRanges(lines: number[]): string {
  const ranges: string[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  for (const line of [...lines, Number.NaN]) {
    if (start !== undefined && previous !== undefined && line === previous + 1) {
      previous = line;
      continue;
    }
    if (start !== undefined && previous !== undefined) {
      ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    }
    start = line;
    previous = line;
  }
  return ranges.join(', ');
}
