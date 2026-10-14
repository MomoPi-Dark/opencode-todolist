import { Database as BunDatabase } from "bun:sqlite";
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Database connection for todo storage.
 *
 * One file holds every session; rows are partitioned by `session_key`. Two
 * separate OpenCode processes reach the same file:
 *
 *   - the server process runs `manage_todo_list` and writes
 *   - the CLI process renders the TUI widget and reads
 *
 * They share no memory, so the PRAGMAs below are not decoration:
 *
 *   - `journal_mode = WAL` lets a reader work while a writer commits
 *   - `busy_timeout` makes a concurrent writer wait instead of failing
 *   - `foreign_keys = ON` is per-connection in SQLite, so it must be set on
 *     every open or the composite parent/child constraint silently stops
 *     being enforced
 *
 * PRAGMAs run before `migrate()` so the migration itself benefits from WAL and
 * enforced foreign keys.
 *
 * `run` is used rather than `exec`: in `bun:sqlite` they are the same call, but
 * `exec` is deprecated in favour of `run`, and a deprecated alias on the hot
 * path is noise in every build.
 */

/**
 * No relations generic: this schema is queried with the core builder
 * (`select`/`insert`/`update`/`delete`), never with relational `db.query`.
 * Drizzle 1.0 dropped `schema` from the SQLite config for that reason, so there
 * is nothing to thread through here.
 */
export type TodoDatabase = SQLiteBunDatabase;

export interface TodoDatabaseHandle {
  /** Raw connection, for statements Drizzle does not expose (e.g. PRAGMA). */
  readonly sqlite: BunDatabase;
  readonly db: TodoDatabase;
  readonly path: string;
}

let handle: TodoDatabaseHandle | undefined;

/**
 * Folder holding the generated migrations.
 *
 * `import.meta.dirname` resolves to the plugin's own directory because OpenCode
 * loads local plugins as ordinary files from disk (not embedded in the host
 * binary). That was verified against a standalone Bun host importing an
 * external plugin: `import.meta.dirname` pointed at the real folder.
 *
 * At runtime this file lives in `dist/storage/`, so the migrations folder sits
 * two levels up at the package root. Each migration is its own timestamped
 * subfolder holding `migration.sql` — the layout `drizzle-kit` 1.0 emits and
 * the migrator reads back.
 */
export function resolveMigrationsFolder(): string {
  return join(import.meta.dirname, "..", "..", "drizzle");
}

export function openDatabase(
  path: string,
  migrationsFolder: string = resolveMigrationsFolder(),
): TodoDatabaseHandle {
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new BunDatabase(path, { create: true });

  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA synchronous = NORMAL");
  sqlite.run("PRAGMA busy_timeout = 5000");
  sqlite.run("PRAGMA cache_size = -64000");
  sqlite.run("PRAGMA foreign_keys = ON");

  const db = drizzle({ client: sqlite });
  migrate(db, { migrationsFolder });

  return { sqlite, db, path };
}

/**
 * Process-wide singleton.
 *
 * Opening is not free: it applies migrations and sets up WAL. The tool and the
 * widget each call this repeatedly, so the connection is created once per
 * process. `resetDatabaseForTests` exists for tests that need a fresh handle.
 */
export function getDatabase(path: string): TodoDatabaseHandle {
  return (handle ??= openDatabase(path));
}

export function resetDatabaseForTests(): void {
  handle?.sqlite.close();
  handle = undefined;
}

/**
 * SQLite's cross-connection change counter.
 *
 * `PRAGMA data_version` changes when *another* connection commits, and stays
 * put for this connection's own writes. That is exactly the signal a reader
 * wants, so the TUI can poll it and skip work when nothing external changed.
 */
export function getDataVersion(sqlite: BunDatabase): number {
  const row = sqlite.query("PRAGMA data_version").get() as {
    data_version?: number;
  } | null;
  return row?.data_version ?? 0;
}
