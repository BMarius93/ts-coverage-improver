import { ValidationError } from '../shared/domain-error';
import { err, ok, Result } from '../shared/result';

/**
 * A repository-relative POSIX path to a TypeScript source file. Rejecting absolute paths and `..`
 * segments matters because the path is later joined to a workspace directory and passed to tools.
 */
export class FilePath {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<FilePath, ValidationError> {
    const value = raw.trim();
    if (value.length === 0 || value.length > 500) {
      return err(new ValidationError('File path must be between 1 and 500 characters'));
    }
    if (value.includes('\\') || value.includes('\0')) {
      return err(new ValidationError(`File path must use forward slashes: ${raw}`));
    }
    if (value.startsWith('/') || value.startsWith('-')) {
      return err(new ValidationError(`File path must be relative: ${raw}`));
    }
    const segments = value.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      return err(new ValidationError(`File path must not contain empty, "." or ".." segments: ${raw}`));
    }
    if (!/^[\w.@+\-/[\]() ]+$/.test(value)) {
      return err(new ValidationError(`File path contains unsupported characters: ${raw}`));
    }
    if (!value.endsWith('.ts') && !value.endsWith('.tsx')) {
      return err(new ValidationError(`File path must point to a TypeScript file: ${raw}`));
    }
    return ok(new FilePath(value));
  }

  get isDeclarationFile(): boolean {
    return this.value.endsWith('.d.ts');
  }

  get isTestFile(): boolean {
    return /\.(test|spec)\.tsx?$/.test(this.value);
  }

  /** Conventional sibling test file, e.g. `src/a/b.ts` -> `src/a/b.test.ts`. */
  defaultTestFile(): FilePath {
    return new FilePath(this.value.replace(/\.(tsx?)$/, '.test.$1'));
  }

  /** A short, branch-name-safe slug, e.g. `src/utils/Date-Parser.ts` -> `src-utils-date-parser`. */
  slug(maxLength = 40): string {
    const slug = this.value
      .replace(/\.tsx?$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug.slice(0, maxLength).replace(/-+$/, '') || 'file';
  }

  equals(other: FilePath): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
