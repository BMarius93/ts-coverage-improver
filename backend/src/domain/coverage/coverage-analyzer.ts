import { DomainError } from '../shared/domain-error';
import { err, ok, Result } from '../shared/result';
import { CoverageSnapshot } from './coverage-snapshot';
import { CoverageThreshold } from './coverage-threshold';
import { FileCoverage } from './file-coverage';

export type SkipReason = 're-exports only';

export interface SkippedFile {
  file: FileCoverage;
  reason: SkipReason;
}

export interface CoverageAnalysis {
  /** Files worth improving: below the threshold, lowest line coverage first. */
  candidates: FileCoverage[];
  /** Files below the threshold that are deliberately not candidates, with the reason (shown in the UI). */
  skipped: SkippedFile[];
}

/** A job was requested for a file that is deliberately not an improvement candidate. */
export class NotAnImprovementCandidateError extends DomainError {
  readonly code = 'NOT_AN_IMPROVEMENT_CANDIDATE';

  constructor(file: FileCoverage, reason: SkipReason) {
    super(`${file.path.value} is not an improvement candidate: ${reason}`);
  }
}

/**
 * Domain service: decides which files need better tests. Files are ranked lowest line coverage
 * first (then by path for a stable order) because those give the biggest gain per PR.
 *
 * Rule: files that only re-export other modules are never candidates, however low their coverage:
 * a test for a barrel file only re-checks the modules it re-exports.
 */
export class CoverageAnalyzer {
  analyze(snapshot: CoverageSnapshot, threshold: CoverageThreshold): CoverageAnalysis {
    const below = snapshot.files
      .filter((file) => !file.path.isTestFile && !file.path.isDeclarationFile)
      .filter((file) => !threshold.isMetBy(file.lines))
      .sort((a, b) => a.lines.value - b.lines.value || a.path.value.localeCompare(b.path.value));
    const candidates: FileCoverage[] = [];
    const skipped: SkippedFile[] = [];
    for (const file of below) {
      const reason = this.skipReason(file);
      if (reason) {
        skipped.push({ file, reason });
      } else {
        candidates.push(file);
      }
    }
    return { candidates, skipped };
  }

  filesNeedingImprovement(snapshot: CoverageSnapshot, threshold: CoverageThreshold): FileCoverage[] {
    return this.analyze(snapshot, threshold).candidates;
  }

  needsImprovement(file: FileCoverage, threshold: CoverageThreshold): boolean {
    return this.skipReason(file) === null && !threshold.isMetBy(file.lines);
  }

  /** Why a file can never be improved, or null if it can (regardless of its current coverage). */
  skipReason(file: FileCoverage): SkipReason | null {
    return file.isReExportOnly ? 're-exports only' : null;
  }

  /** Guard used before queueing a job for a file. */
  assertImprovable(file: FileCoverage): Result<void, NotAnImprovementCandidateError> {
    const reason = this.skipReason(file);
    return reason ? err(new NotAnImprovementCandidateError(file, reason)) : ok(undefined);
  }
}
