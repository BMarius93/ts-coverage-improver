import { CoveragePercentage } from './coverage-percentage';
import { FilePath } from './file-path';

export interface FileCoverageMetrics {
  lines: CoveragePercentage;
  branches: CoveragePercentage;
  functions: CoveragePercentage;
  statements: CoveragePercentage;
}

/** Coverage of a single source file. Line coverage is the metric the threshold is applied to. */
export class FileCoverage {
  constructor(
    readonly path: FilePath,
    readonly metrics: FileCoverageMetrics,
  ) {}

  get lines(): CoveragePercentage {
    return this.metrics.lines;
  }
}
