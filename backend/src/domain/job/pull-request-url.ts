import { ValidationError } from '../shared/domain-error';
import { err, ok, Result } from '../shared/result';

const PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/(\d+)$/;

/** Link to a GitHub pull request opened for a job. */
export class PullRequestUrl {
  private constructor(
    readonly value: string,
    readonly number: number,
  ) {}

  static create(raw: string): Result<PullRequestUrl, ValidationError> {
    const match = PATTERN.exec(raw.trim());
    if (!match) {
      return err(new ValidationError(`Not a GitHub pull request URL: ${raw}`));
    }
    return ok(new PullRequestUrl(raw.trim(), Number(match[1])));
  }

  toString(): string {
    return this.value;
  }
}
