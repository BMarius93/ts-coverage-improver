import { CoveragePercentage } from '../../../domain/coverage/coverage-percentage';
import { CoverageSnapshot } from '../../../domain/coverage/coverage-snapshot';
import { FileCoverage } from '../../../domain/coverage/file-coverage';
import { FilePath } from '../../../domain/coverage/file-path';
import { GitHubRepoUrl } from '../../../domain/repository/github-repo-url';
import { Repository, ScanStatus } from '../../../domain/repository/repository';
import { RepositoryRepository } from '../../../domain/repository/repository-repository';
import { ConflictError } from '../../../domain/shared/domain-error';
import { unwrap } from '../../../domain/shared/result';
import { asPromise, isUniqueViolation, SqliteDatabase } from './sqlite-database';

interface RepositoryRow {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string | null;
  scan_status: ScanStatus;
  scan_error: string | null;
  scan_started_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow {
  id: number;
  commit_sha: string;
  taken_at: string;
}

interface FileCoverageRow {
  path: string;
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

const date = (value: string | null): Date | null => (value === null ? null : new Date(value));

export class SqliteRepositoryRepository implements RepositoryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  save(repository: Repository): Promise<void> {
    return asPromise(() => {
      try {
        this.saveSync(repository);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(`Repository ${repository.url.fullName} is already registered`);
        }
        throw error;
      }
    });
  }

  private saveSync(repository: Repository): void {
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `INSERT INTO repositories (id, owner, name, full_name, default_branch, scan_status, scan_error,
                                       scan_started_at, created_at, updated_at)
             VALUES (@id, @owner, @name, @full_name, @default_branch, @scan_status, @scan_error,
                     @scan_started_at, @created_at, @updated_at)
             ON CONFLICT (id) DO UPDATE SET
               default_branch = excluded.default_branch, scan_status = excluded.scan_status,
               scan_error = excluded.scan_error, scan_started_at = excluded.scan_started_at,
               updated_at = excluded.updated_at`,
          )
          .run({
            id: repository.id,
            owner: repository.url.owner,
            name: repository.url.name,
            full_name: repository.url.fullName,
            default_branch: repository.defaultBranch,
            scan_status: repository.scanStatus,
            scan_error: repository.scanError,
            scan_started_at: repository.scanStartedAt?.toISOString() ?? null,
            created_at: repository.createdAt.toISOString(),
            updated_at: repository.updatedAt.toISOString(),
          });
        const snapshot = repository.latestSnapshot;
        if (snapshot && !this.isStored(repository.id, snapshot)) {
          this.insertSnapshot(repository.id, snapshot);
        }
      })
      .immediate();
  }

  findById(id: string): Promise<Repository | null> {
    return asPromise(() => {
      const row = this.db.prepare<[string], RepositoryRow>('SELECT * FROM repositories WHERE id = ?').get(id);
      return row ? this.toDomain(row) : null;
    });
  }

  findByUrl(url: GitHubRepoUrl): Promise<Repository | null> {
    return asPromise(() => {
      const row = this.db
        .prepare<[string], RepositoryRow>('SELECT * FROM repositories WHERE full_name = ?')
        .get(url.fullName);
      return row ? this.toDomain(row) : null;
    });
  }

  findAll(): Promise<Repository[]> {
    return asPromise(() =>
      this.db
        .prepare<[], RepositoryRow>('SELECT * FROM repositories ORDER BY created_at, id')
        .all()
        .map((row) => this.toDomain(row)),
    );
  }

  private latestSnapshotRow(repositoryId: string): SnapshotRow | undefined {
    return this.db
      .prepare<[string], SnapshotRow>(
        'SELECT id, commit_sha, taken_at FROM coverage_snapshots WHERE repository_id = ? ORDER BY id DESC LIMIT 1',
      )
      .get(repositoryId);
  }

  private isStored(repositoryId: string, snapshot: CoverageSnapshot): boolean {
    const latest = this.latestSnapshotRow(repositoryId);
    return (
      latest !== undefined &&
      latest.commit_sha === snapshot.commitSha &&
      latest.taken_at === snapshot.takenAt.toISOString()
    );
  }

  private insertSnapshot(repositoryId: string, snapshot: CoverageSnapshot): void {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO coverage_snapshots (repository_id, commit_sha, taken_at) VALUES (?, ?, ?)')
      .run(repositoryId, snapshot.commitSha, snapshot.takenAt.toISOString());
    const insertFile = this.db.prepare(
      `INSERT INTO file_coverages (snapshot_id, path, lines, branches, functions, statements)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const file of snapshot.files) {
      const m = file.metrics;
      insertFile.run(
        lastInsertRowid,
        file.path.value,
        m.lines.value,
        m.branches.value,
        m.functions.value,
        m.statements.value,
      );
    }
  }

  private loadSnapshot(repositoryId: string): CoverageSnapshot | null {
    const row = this.latestSnapshotRow(repositoryId);
    if (!row) {
      return null;
    }
    const files = this.db
      .prepare<[number], FileCoverageRow>('SELECT * FROM file_coverages WHERE snapshot_id = ?')
      .all(row.id)
      .map(
        (file) =>
          new FileCoverage(unwrap(FilePath.create(file.path)), {
            lines: unwrap(CoveragePercentage.create(file.lines)),
            branches: unwrap(CoveragePercentage.create(file.branches)),
            functions: unwrap(CoveragePercentage.create(file.functions)),
            statements: unwrap(CoveragePercentage.create(file.statements)),
          }),
      );
    return unwrap(
      CoverageSnapshot.create({ commitSha: row.commit_sha, takenAt: new Date(row.taken_at), files }),
    );
  }

  private toDomain(row: RepositoryRow): Repository {
    return Repository.reconstitute({
      id: row.id,
      url: unwrap(GitHubRepoUrl.create(`https://github.com/${row.owner}/${row.name}`)),
      defaultBranch: row.default_branch,
      scanStatus: row.scan_status,
      scanError: row.scan_error,
      scanStartedAt: date(row.scan_started_at),
      latestSnapshot: this.loadSnapshot(row.id),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}
