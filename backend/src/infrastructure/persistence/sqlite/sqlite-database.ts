import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type SqliteDatabase = Database.Database;

const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Opens (and migrates) the SQLite database.
 * - WAL lets readers (API) and the writer (worker) work concurrently.
 * - busy_timeout makes a second writer wait for the lock instead of failing immediately.
 */
export function openDatabase(path: string): SqliteDatabase {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

/** Applies `migrations/NNN_name.sql` files in order, each once, each in its own transaction. */
export function migrate(db: SqliteDatabase, migrationsDir = MIGRATIONS_DIR): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    db
      .prepare<[], { name: string }>('SELECT name FROM schema_migrations')
      .all()
      .map((row) => row.name),
  );
  const pending = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql') && !applied.has(file))
    .sort();
  for (const file of pending) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      );
    }).immediate();
  }
  return pending;
}

/**
 * better-sqlite3 is synchronous; the domain contracts are async so other stores can be plugged in.
 * Wrapping keeps errors as rejections instead of synchronous throws.
 */
export function asPromise<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
