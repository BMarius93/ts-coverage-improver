import { ValidationError } from '../shared/domain-error';
import { err, ok, Result } from '../shared/result';
import { FileCoverage } from './file-coverage';
import { FilePath } from './file-path';

export interface CoverageSnapshotProps {
  commitSha: string;
  takenAt: Date;
  files: FileCoverage[];
}

/** Coverage of every measured file of a repository at one commit. Immutable. */
export class CoverageSnapshot {
  private readonly byPath: ReadonlyMap<string, FileCoverage>;

  private constructor(
    readonly commitSha: string,
    readonly takenAt: Date,
    files: FileCoverage[],
  ) {
    this.byPath = new Map(files.map((file) => [file.path.value, file]));
  }

  static create(props: CoverageSnapshotProps): Result<CoverageSnapshot, ValidationError> {
    if (!/^[0-9a-f]{7,40}$/.test(props.commitSha)) {
      return err(new ValidationError(`Invalid commit SHA: ${props.commitSha}`));
    }
    const paths = new Set<string>();
    for (const file of props.files) {
      if (paths.has(file.path.value)) {
        return err(new ValidationError(`Duplicate file in snapshot: ${file.path.value}`));
      }
      paths.add(file.path.value);
    }
    const sorted = [...props.files].sort((a, b) => a.path.value.localeCompare(b.path.value));
    return ok(new CoverageSnapshot(props.commitSha, props.takenAt, sorted));
  }

  get files(): FileCoverage[] {
    return [...this.byPath.values()];
  }

  fileFor(path: FilePath): FileCoverage | undefined {
    return this.byPath.get(path.value);
  }
}
