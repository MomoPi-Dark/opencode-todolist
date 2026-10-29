import { Database as BunDatabase } from "bun:sqlite";
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Database connection for todo storage.
 *
 * One file holds every session; rows are partitioned by `session_key`. Two
 * separate OpenCode processes reach the same file:
 *
 *   - the server process runs the todo tool and writes
 *   - the CLI process renders the TUI widget and reads
 *
 * They share no memory, so the PRAGMAs below are not decoration.
 */

// Types

/**
 * No relations generic: this schema is queried with the core builder
 * (`select`/`insert`/`update`/`delete`), never with relational `db.query`.
 */
type TodoDatabase = SQLiteBunDatabase;

export interface TodoDatabaseHandle {
  /** Raw connection, for statements Drizzle does not expose (e.g. PRAGMA). */
  readonly sqlite: BunDatabase;
  readonly db: TodoDatabase;
  readonly path: string;
}

// Configuration

/**
 * Applied on every open, before `migrate()`, so the migration itself runs
 * under WAL and enforced foreign keys.
 *
 *   - `journal_mode = WAL`  lets a reader work while a writer commits
 *   - `busy_timeout`        makes a concurrent writer wait instead of failing
 *   - `foreign_keys = ON`   is per-connection in SQLite; without it the
 *                           parent/child constraint silently stops being
 *                           enforced
 */
const PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA busy_timeout = 5000",
  "PRAGMA cache_size = -64000",
  "PRAGMA foreign_keys = ON",
] as const;

/**
 * Folder holding the generated migrations.
 *
 * `import.meta.dirname` is the plugin's own directory, because OpenCode loads
 * local plugins as ordinary files from disk. This file lives in
 * `dist/storage/`, so the folder sits two levels up at the package root. Each
 * migration is a timestamped subfolder holding `migration.sql`, the layout
 * `drizzle-kit` 1.0 emits and the migrator reads back.
 */
export function resolveMigrationsFolder(): string {
  return join(import.meta.dirname, "..", "..", "drizzle");
}

// Opening

/**
 * Copies a database opened by an older build into the current location.
 *
 * `VACUUM INTO` writes a consistent copy without modifying the source, so a
 * crash mid-copy leaves the old file intact and the next open simply retries.
 * The source is renamed only after the copy exists, which is why the old file
 * is never deleted — a failed upgrade stays recoverable by hand.
 *
 * Returns true when a copy was made.
 */
export function copyLegacyDatabase(
  legacyPath: string,
  path: string,
): boolean {
  if (!existsSync(legacyPath) || existsSync(path)) return false;

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let source: BunDatabase | undefined;
  try {
    source = new BunDatabase(legacyPath, { readonly: true });
    source.run("PRAGMA busy_timeout = 5000");
    // Target path cannot be bound; quote it as a SQLite string literal.
    source.run(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  } catch (error) {
    // Half-written target would block every later attempt.
    rmSync(path, { force: true });
    throw error;
  } finally {
    source?.close();
  }

  // A `.migrated` file is *already* a consumed marker — renaming it again
  // would only stack suffixes (`.migrated.migrated`) on every upgrade.
  if (!legacyPath.endsWith(".migrated")) {
    try {
      renameSync(legacyPath, `${legacyPath}.migrated`);
    } catch {
      // The copy already landed; a failed rename only means the next open sees
      // both files, which `existsSync(path)` short-circuits.
    }
  }
  return true;
}

/**
 * Tries every database an older build may have left behind, newest name first.
 *
 * `todos.db` is the pre-v2 location; `todos.db.migrated` is that same file
 * after an earlier upgrade renamed it. Both are valid sources, and `path`
 * winning over both is what makes the copy idempotent.
 */
export function adoptLegacyDatabase(
  legacyDir: string,
  path: string,
): string | undefined {
  for (const name of ["todos.db", "todos.db.migrated"]) {
    const source = join(legacyDir, name);
    if (copyLegacyDatabase(source, path)) return source;
  }
  return undefined;
}

function applyPragmas(sqlite: BunDatabase): void {
  for (const pragma of PRAGMAS) sqlite.run(pragma);
}

/**
 * Restricts the database to its owner.
 *
 * A todo list names the work someone is doing and sometimes says why, so on a
 * shared POSIX host another account must not read it. `mkdir` with a mode only
 * applies when the directory is *created*, and an existing install may already
 * be 0755, so both paths are tightened explicitly.
 *
 * Windows has no POSIX mode bits — access follows the user-profile ACLs — so
 * chmod would be a no-op there and is skipped.
 */
function privatize(dir: string, dbPath: string): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Directory vanished or is read-only: the open below will report it.
  }
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      chmodSync(path, 0o600);
    } catch {
      // The -wal/-shm files are created by the first write and vanish on the
      // last close; absent is normal, not a failure.
    }
  }
}

export function openDatabase(
  path: string,
  migrationsFolder: string = resolveMigrationsFolder(),
): TodoDatabaseHandle {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  const sqlite = new BunDatabase(path, { create: true });
  try {
    applyPragmas(sqlite);
    // After the PRAGMAs, so the -wal/-shm files they create are covered too.
    privatize(dirname(path), path);
    const db = drizzle({ client: sqlite });
    migrate(db, { migrationsFolder });
    return { sqlite, db, path };
  } catch (error) {
    // Do not leak the file descriptor when a PRAGMA or a migration fails.
    sqlite.close();
    throw error;
  }
}

// Process-wide singleton

type CachedDatabase = { path: string; handle: TodoDatabaseHandle };

/**
 * Keyed on `globalThis` via `Symbol.for` so two module instances loaded into
 * the same process still share one connection cache and never double-init.
 */
const GLOBAL_DB_KEY = Symbol.for("opencode.todolist.db");

function getCached(): CachedDatabase | undefined {
  return (globalThis as Record<symbol, CachedDatabase | undefined>)[
    GLOBAL_DB_KEY
  ];
}

function setCached(value: CachedDatabase | undefined): void {
  (globalThis as Record<symbol, CachedDatabase | undefined>)[GLOBAL_DB_KEY] =
    value;
}

/**
 * Opening is not free: it applies migrations and sets up WAL. The tool and the
 * widget each call this repeatedly, so the connection is created once per
 * process and reused — unless a different path is requested, in which case the
 * old connection is closed and replaced rather than silently reused.
 */
export function getDatabase(path: string): TodoDatabaseHandle {
  const cached = getCached();
  if (cached?.path === path) return cached.handle;

  // Close the superseded connection: two open handles to two files would leak a
  // file descriptor, and `resetDatabaseForTests` could only ever close one.
  cached?.handle.sqlite.close();
  const next: CachedDatabase = { path, handle: openDatabase(path) };
  setCached(next);
  return next.handle;
}

/** Closes and forgets the cached connection, so the next call opens a fresh one. */
export function resetDatabaseForTests(): void {
  getCached()?.handle.sqlite.close();
  setCached(undefined);
}

// Change detection

/**
 * SQLite's cross-connection change counter.
 *
 * `PRAGMA data_version` changes when *another* connection commits and stays put
 * for this connection's own writes. That is the signal a reader wants, so the
 * TUI can poll it and skip work when nothing external changed.
 */
export function getDataVersion(sqlite: BunDatabase): number {
  const row = sqlite.query("PRAGMA data_version").get() as {
    data_version?: number;
  } | null;
  return row?.data_version ?? 0;
}
