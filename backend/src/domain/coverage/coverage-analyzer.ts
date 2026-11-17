import { CoverageSnapshot } from './coverage-snapshot';
import { CoverageThreshold } from './coverage-threshold';
import { FileCoverage } from './file-coverage';

/**
 * Domain service: decides which files need better tests. Files are ranked lowest line coverage
 * first (then by path for a stable order) because those give the biggest gain per PR.
 */
export class CoverageAnalyzer {
  filesNeedingImprovement(snapshot: CoverageSnapshot, threshold: CoverageThreshold): FileCoverage[] {
    return snapshot.files
      .filter((file) => !file.path.isTestFile && !file.path.isDeclarationFile)
      .filter((file) => !threshold.isMetBy(file.lines))
      .sort((a, b) => a.lines.value - b.lines.value || a.path.value.localeCompare(b.path.value));
  }

  needsImprovement(file: FileCoverage, threshold: CoverageThreshold): boolean {
    return !threshold.isMetBy(file.lines);
  }
}
