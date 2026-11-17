import { Repository } from '../../../src/domain/repository/repository';
import { ConflictError } from '../../../src/domain/shared/domain-error';
import { SqliteDatabase, migrate } from '../../../src/infrastructure/persistence/sqlite/sqlite-database';
import { SqliteRepositoryRepository } from '../../../src/infrastructure/persistence/sqlite/sqlite-repository-repository';
import { at, repoUrl, snapshot, T0 } from '../../support/builders';
import { tempDatabase } from '../../support/sqlite';

describe('SqliteRepositoryRepository', () => {
  let db: SqliteDatabase;
  let cleanup: () => void;
  let repositories: SqliteRepositoryRepository;

  beforeEach(() => {
    ({ db, cleanup } = tempDatabase());
    repositories = new SqliteRepositoryRepository(db);
  });
  afterEach(() => cleanup());

  it('uses WAL, a busy timeout and foreign keys, and migrates only once', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(migrate(db)).toEqual([]);
  });

  it('round-trips a repository with its latest snapshot', async () => {
    const repo = Repository.register({
      id: 'repo-1',
      url: repoUrl('https://github.com/Acme/Widgets'),
      now: T0,
    });
    await repositories.save(repo);
    expect((await repositories.findById('repo-1'))?.latestSnapshot).toBeNull();

    repo.startScan(at(1));
    repo.completeScan({
      snapshot: snapshot([
        ['src/a.ts', 12.5],
        ['src/b.ts', 90],
      ]),
      defaultBranch: 'main',
      now: at(2),
    });
    await repositories.save(repo);
    await repositories.save(repo); // saving again must not duplicate the snapshot

    const loaded = await repositories.findByUrl(repoUrl('https://github.com/acme/widgets'));
    expect(loaded?.id).toBe('repo-1');
    expect(loaded?.url.owner).toBe('Acme');
    expect(loaded?.scanStatus).toBe('succeeded');
    expect(loaded?.defaultBranch).toBe('main');
    expect(loaded?.scanStartedAt).toEqual(at(1));
    expect(loaded?.latestSnapshot?.files.map((f) => [f.path.value, f.lines.value])).toEqual([
      ['src/a.ts', 12.5],
      ['src/b.ts', 90],
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM coverage_snapshots').get()).toEqual({ n: 1 });
  });

  it('keeps snapshot history but loads the latest one', async () => {
    const repo = Repository.register({ id: 'repo-1', url: repoUrl(), now: T0 });
    for (const [i, lines] of [10, 20].entries()) {
      repo.startScan(at(i * 10));
      repo.completeScan({
        snapshot: snapshot([['src/a.ts', lines]], `abcdef${i}`),
        defaultBranch: 'main',
        now: at(i * 10 + 1),
      });
      await repositories.save(repo);
    }
    const loaded = await repositories.findById('repo-1');
    expect(loaded?.latestSnapshot?.commitSha).toBe('abcdef1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM coverage_snapshots').get()).toEqual({ n: 2 });
  });

  it('lists repositories and returns null for unknown ones', async () => {
    await repositories.save(
      Repository.register({ id: 'b', url: repoUrl('https://github.com/acme/b'), now: at(2) }),
    );
    await repositories.save(
      Repository.register({ id: 'a', url: repoUrl('https://github.com/acme/a'), now: at(1) }),
    );
    expect((await repositories.findAll()).map((r) => r.id)).toEqual(['a', 'b']);
    expect(await repositories.findById('zzz')).toBeNull();
    expect(await repositories.findByUrl(repoUrl('https://github.com/acme/zzz'))).toBeNull();
  });

  it('enforces one row per GitHub repository', async () => {
    await repositories.save(Repository.register({ id: 'a', url: repoUrl(), now: T0 }));
    await expect(
      repositories.save(
        Repository.register({ id: 'b', url: repoUrl('https://github.com/ACME/widgets'), now: T0 }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
