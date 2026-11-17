import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, SqliteDatabase } from '../../src/infrastructure/persistence/sqlite/sqlite-database';

/** A migrated SQLite database in a fresh temp directory (a real file, so WAL and locking apply). */
export function tempDatabase(): { db: SqliteDatabase; path: string; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-improver-db-'));
  const path = join(dir, 'test.db');
  const db = openDatabase(path);
  return {
    db,
    path,
    dir,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
