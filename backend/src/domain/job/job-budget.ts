import { ValidationError } from '../shared/domain-error';
import { err, ok, Result } from '../shared/result';

/**
 * Limits for one improvement job: total AI spend across all calls and attempts, and a wall-clock deadline
 * (counted from the request, so time spent queued counts too).
 */
export class JobBudget {
  private constructor(
    readonly maxCostUsd: number,
    readonly deadline: Date,
  ) {}

  static create(props: { maxCostUsd: number; deadline: Date }): Result<JobBudget, ValidationError> {
    if (!Number.isFinite(props.maxCostUsd) || props.maxCostUsd <= 0) {
      return err(new ValidationError(`Job AI budget must be a positive amount, got ${props.maxCostUsd}`));
    }
    if (Number.isNaN(props.deadline.getTime())) {
      return err(new ValidationError('Job deadline must be a valid date'));
    }
    return ok(new JobBudget(props.maxCostUsd, props.deadline));
  }

  /** Budget for a job requested at `now`. */
  static startingAt(
    now: Date,
    maxCostUsd: number,
    maxDurationMs: number,
  ): Result<JobBudget, ValidationError> {
    if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
      return err(new ValidationError(`Job duration limit must be positive, got ${maxDurationMs}`));
    }
    return JobBudget.create({ maxCostUsd, deadline: new Date(now.getTime() + maxDurationMs) });
  }

  isPastDeadline(now: Date): boolean {
    return now.getTime() > this.deadline.getTime();
  }
}
