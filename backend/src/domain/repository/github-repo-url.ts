import { ValidationError } from '../shared/domain-error';
import { err, ok, Result } from '../shared/result';

const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const NAME = '[A-Za-z0-9._-]{1,100}';
const HTTPS_PATTERN = new RegExp(`^https://github\\.com/(${OWNER})/(${NAME}?)(?:\\.git)?/?$`);
const SSH_PATTERN = new RegExp(`^git@github\\.com:(${OWNER})/(${NAME}?)(?:\\.git)?$`);

/**
 * Identifies a GitHub repository. Accepts the HTTPS or SSH form a user would copy from GitHub and
 * normalises it, so two spellings of the same repository compare equal.
 */
export class GitHubRepoUrl {
  private constructor(
    readonly owner: string,
    readonly name: string,
  ) {}

  static create(raw: string): Result<GitHubRepoUrl, ValidationError> {
    const value = raw.trim();
    const match = HTTPS_PATTERN.exec(value) ?? SSH_PATTERN.exec(value);
    if (!match) {
      return err(new ValidationError(`Not a GitHub repository URL: ${raw}`));
    }
    const [, owner, name] = match;
    if (name === '.' || name === '..' || name.endsWith('.')) {
      return err(new ValidationError(`Invalid repository name: ${name}`));
    }
    return ok(new GitHubRepoUrl(owner, name));
  }

  /** `owner/name`, lower-cased because GitHub treats both parts case-insensitively. */
  get fullName(): string {
    return `${this.owner}/${this.name}`.toLowerCase();
  }

  get cloneUrl(): string {
    return `https://github.com/${this.owner}/${this.name}.git`;
  }

  get webUrl(): string {
    return `https://github.com/${this.owner}/${this.name}`;
  }

  equals(other: GitHubRepoUrl): boolean {
    return this.fullName === other.fullName;
  }

  toString(): string {
    return this.webUrl;
  }
}
