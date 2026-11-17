import { CoveragePercentage } from './coverage-percentage';
import { FilePath } from './file-path';

export interface FileCoverageMetrics {
  lines: CoveragePercentage;
  branches: CoveragePercentage;
  functions: CoveragePercentage;
  statements: CoveragePercentage;
}

/**
 * What a source file is, as far as test value goes. A `re-export-only` file (a "barrel" such as an index.ts
 * made of `export … from` statements) has no logic of its own, so testing it adds nothing.
 */
export type FileKind = 'module' | 're-export-only';

/** Coverage of a single source file. Line coverage is the metric the threshold is applied to. */
export class FileCoverage {
  constructor(
    readonly path: FilePath,
    readonly metrics: FileCoverageMetrics,
    readonly kind: FileKind = 'module',
  ) {}

  get lines(): CoveragePercentage {
    return this.metrics.lines;
  }

  get isReExportOnly(): boolean {
    return this.kind === 're-export-only';
  }

  withKind(kind: FileKind): FileCoverage {
    return new FileCoverage(this.path, this.metrics, kind);
  }
}
