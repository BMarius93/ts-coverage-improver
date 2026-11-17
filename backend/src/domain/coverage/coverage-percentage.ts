import { ValidationError } from '../shared/domain-error';
import { err, ok, Result } from '../shared/result';

/** A coverage ratio in the closed range [0, 100], stored with two decimals. */
export class CoveragePercentage {
  private constructor(readonly value: number) {}

  static create(value: number): Result<CoveragePercentage, ValidationError> {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return err(new ValidationError(`Coverage percentage must be between 0 and 100, got ${value}`));
    }
    return ok(new CoveragePercentage(Math.round(value * 100) / 100));
  }

  static zero(): CoveragePercentage {
    return new CoveragePercentage(0);
  }

  /** Builds a percentage from covered/total counts; a file with nothing to cover counts as 100%. */
  static fromCounts(covered: number, total: number): Result<CoveragePercentage, ValidationError> {
    if (
      !Number.isInteger(covered) ||
      !Number.isInteger(total) ||
      covered < 0 ||
      total < 0 ||
      covered > total
    ) {
      return err(new ValidationError(`Invalid coverage counts ${covered}/${total}`));
    }
    return CoveragePercentage.create(total === 0 ? 100 : (covered / total) * 100);
  }

  isGreaterThan(other: CoveragePercentage): boolean {
    return this.value > other.value;
  }

  equals(other: CoveragePercentage): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return `${this.value.toFixed(2)}%`;
  }
}
