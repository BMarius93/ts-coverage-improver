import { ValidationError } from '../shared/domain-error';
import { err, ok, Result } from '../shared/result';
import { CoveragePercentage } from './coverage-percentage';

/** The minimum line coverage a file must reach to be considered healthy. */
export class CoverageThreshold {
  static readonly DEFAULT_VALUE = 80;

  private constructor(readonly value: number) {}

  static create(value: number): Result<CoverageThreshold, ValidationError> {
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      return err(new ValidationError(`Coverage threshold must be in (0, 100], got ${value}`));
    }
    return ok(new CoverageThreshold(value));
  }

  static default(): CoverageThreshold {
    return new CoverageThreshold(CoverageThreshold.DEFAULT_VALUE);
  }

  isMetBy(coverage: CoveragePercentage): boolean {
    return coverage.value >= this.value;
  }
}
