import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { posix, win32 } from "node:path";
import type { TodoRootItem } from "../schemas/todo/item";
import { TodoTree } from "../todos/todo-tree";
import {
  adoptLegacyDatabase,
  getDatabase,
  getDataVersion as readDataVersion,
  resetDatabaseForTests,
  type TodoDatabaseHandle,
} from "./db";
import {
  importLegacyJson,
  mutateSessionTodos,
  readRevision,
  selectTodos,
  type MigrationResult,
} from "./migrate-json";
import { todoSession } from "./schema";

/**
 * Per-session todo persistence on SQLite.
 *
 * Storage shape:
 *
 *   <base>/todos.db          one file, every session, partitioned by session_key
 *   <base>/todos.db-wal      write-ahead log
 *
 * The public API is unchanged from the previous JSON implementation, so the
 * tool, the hint builder, and the TUI widget keep working without edits. Only
 * the storage engine moved.
 *
 * Why SQLite here:
 * - `parent_id` becomes a real foreign key, so a subtask cannot dangle
 * - a full-list write is one transaction, so a reader never sees a half list
 * - `PRAGMA data_version` lets the TUI detect writes made by the other process
 *
 * The tool and the widget run in separate processes, so nothing is shared in
 * memory and this file is the hand-off point.
 */

/**
 * Environment/OS context used to resolve storage locations. Every field is
 * optional so callers and tests can simulate any platform on any host.
 */
export interface PlatformContext {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  home?: string;
}

export interface TodoData {
  version: number;
  todos: TodoRootItem[];
  created_at: string;
  updated_at: string;
}

const FILE_NAME = "todos.db";

export class TodoStore {
  private static readonly SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

  private readonly importedBaseDirs = new Set<string>();
  private legacyDatabaseChecked = false;
  private migration: MigrationResult = { imported: [], skipped: [], failed: [] };

  constructor(private readonly ctx: PlatformContext = {}) { }

  // Static helpers

  public static normalizeSessionID(sessionID: string): string {
    const normalized = sessionID.trim();
    if (!TodoStore.SESSION_ID_PATTERN.test(normalized)) {
      throw new Error("invalid session ID");
    }
    return normalized;
  }

  /**
   * Storage partition key for a session: the OpenCode session id verbatim.
   *
   * The id is already unique and `normalizeSessionID` already restricts it to
   * `[A-Za-z0-9_-]`, so hashing it bought nothing and cost readability — a raw
   * id can be traced back to a session by eye, a digest cannot.
   */
  public static sessionKey(sessionID: string): string {
    return TodoStore.normalizeSessionID(sessionID);
  }

  /**
   * The key older builds used for this session, kept so their rows still work.
   *
   * A SHA-256 digest cannot be reversed, so a stored hash can never be turned
   * back into an id. It does not need to be: hashing is deterministic, so given
   * the id we recompute the same digest and find the old row, which is what
   * `resolveKey` does. A session that already has rows keeps its old key; only
   * sessions that are new get the readable one.
   */
  public static legacyKey(sessionID: string): string {
    const normalized = TodoStore.normalizeSessionID(sessionID);
    const digest = createHash("sha256").update(normalized).digest("hex");
    return `s_${digest.slice(0, 32)}`;
  }

  /** @deprecated Use {@link TodoStore.legacyKey}; kept for existing callers. */
  public static hashSessionID(sessionID: string): string {
    return TodoStore.legacyKey(sessionID);
  }

  // Platform / directory resolution

  private get env(): Record<string, string | undefined> {
    return this.ctx.env ?? process.env;
  }

  private get platform(): NodeJS.Platform {
    return this.ctx.platform ?? process.platform;
  }

  private joinForPlatform(...parts: string[]): string {
    return this.platform === "win32"
      ? win32.join(...parts)
      : posix.join(...parts);
  }

  public resolveHomeDir(): string {
    const { env, platform } = this;
    if (this.ctx.home) return this.ctx.home;

    if (platform === "win32") {
      if (env.USERPROFILE) return env.USERPROFILE;
      if (env.HOMEDRIVE && env.HOMEPATH)
        return `${env.HOMEDRIVE}${env.HOMEPATH}`;
      if (env.HOME) return env.HOME;
    } else {
      if (env.HOME) return env.HOME;
      if (env.USERPROFILE) return env.USERPROFILE;
    }

    try {
      return homedir();
    } catch {
      return tmpdir();
    }
  }

  /**
   * Base directory holding the database and the legacy session folders.
   *
   * Priority (same on every OS, Windows included):
   *   1. `OPENCODE_TODOS_DIR` — explicit override; must be absolute.
   *   2. `$XDG_DATA_HOME/opencode/todolist` — ignored unless absolute (XDG spec).
   *   3. `<home>/.local/share/opencode/todolist`
   */
  public resolveTodosBaseDir(): string {
    const override = this.env.OPENCODE_TODOS_DIR;
    if (override) {
      if (!this.isAbsolute(override)) {
        throw new Error("OPENCODE_TODOS_DIR must be an absolute path");
      }
      return override;
    }
    const xdg = this.env.XDG_DATA_HOME;
    if (xdg && this.isAbsolute(xdg)) {
      return this.joinForPlatform(xdg, "opencode", "todolist");
    }
    return this.joinForPlatform(
      this.resolveHomeDir(),
      ".local",
      "share",
      "opencode",
      "todolist",
    );
  }

  /** Pre-XDG locations (`.opencode/sessions` and `.opencode/session`). */
  public resolveLegacyBaseDirs(): string[] {
    const home = this.resolveHomeDir();
    return [
      this.joinForPlatform(home, ".opencode", "sessions"),
      this.joinForPlatform(home, ".opencode", "session"),
    ];
  }

  /** Pre-XDG location. Only read for migration and legacy JSON import. */
  public resolveLegacyBaseDir(): string {
    return this.resolveLegacyBaseDirs()[0]!;
  }

  private isAbsolute(path: string): boolean {
    return this.platform === "win32"
      ? win32.isAbsolute(path)
      : posix.isAbsolute(path);
  }

  public getDatabasePath(): string {
    return this.joinForPlatform(this.resolveTodosBaseDir(), FILE_NAME);
  }

  public getTodosDirectory(): string {
    return this.resolveTodosBaseDir();
  }

  // Connection

  private database(): TodoDatabaseHandle {
    // An explicit override means "this directory and nothing else". Without
    // this guard a test that points the store at a temp dir would migrate — and
    // rename — the real user's database on first read.
    const overridden = Boolean(this.env.OPENCODE_TODOS_DIR);
    const path = this.getDatabasePath();

    // The connection cache lives in `db.ts` alone. Adopting a legacy database
    // has to happen before that cache opens the file, but only once: the copy
    // is idempotent and `adoptLegacyDatabase` returns undefined afterwards.
    if (!overridden && !this.legacyDatabaseChecked) {
      for (const legacyDir of this.resolveLegacyBaseDirs()) {
        try {
          const adopted = adoptLegacyDatabase(legacyDir, path);
          if (adopted) {
            this.migration.imported.push(adopted);
            break;
          }
        } catch (error) {
          const file = this.joinForPlatform(legacyDir, FILE_NAME);
          if (!this.migration.failed.some((entry) => entry.file === file)) {
            this.migration.failed.push({
              file,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          throw error;
        }
      }
      this.legacyDatabaseChecked = true;
    }

    const handle = getDatabase(path);

    // Import legacy JSON once per base directory for this process. The old
    // per-session JSON lived under `<home>/.opencode/sessions`, so that folder
    // is still scanned even though new data no longer goes there.
    const baseDirs = overridden
      ? [this.resolveTodosBaseDir()]
      : [this.resolveTodosBaseDir(), ...this.resolveLegacyBaseDirs()];
    for (const baseDir of new Set(baseDirs)) {
      if (this.importedBaseDirs.has(baseDir)) continue;
      const result = importLegacyJson(handle, baseDir);
      this.migration.imported.push(...result.imported);
      this.migration.skipped.push(...result.skipped);
      this.migration.failed.push(...result.failed);
      this.importedBaseDirs.add(baseDir);
    }
    return handle;
  }

  /**
   * What the upgrade did, for callers that need to tell the user.
   *
   * A failed entry means legacy data is still on disk but not yet in the
   * database — the upgrade never guesses and never deletes, so the source is
   * still there to fix or import by hand.
   */
  public getMigrationReport(): MigrationResult {
    // Force the lazy upgrade so the report is complete even if nothing has
    // been read yet.
    try {
      this.database();
    } catch {
      // Legacy DB adoption failed; its entry is already in `this.migration.failed`.
    }
    return {
      imported: [...this.migration.imported],
      skipped: [...this.migration.skipped],
      failed: [...this.migration.failed],
    };
  }

  /**
   * A one-line warning when the upgrade could not finish, undefined otherwise.
   *
   * Deliberately short and file-named: the model only needs to know that
   * something did not arrive and where to look. The full detail stays in
   * `getMigrationReport()`.
   */
  public getMigrationWarning(): string | undefined {
    const { failed } = this.getMigrationReport();
    if (failed.length === 0) return undefined;

    const names = failed.map((entry) => entry.file).join(", ");
    const legacyDir = this.joinForPlatform(
      this.resolveLegacyBaseDir(),
      "",
    ).replace(/[/\\]$/, "");
    return `Todo upgrade incomplete: ${failed.length} legacy file(s) could not be imported (${names}). They are still in ${legacyDir}; fix or import them by hand. Everything else migrated to ${this.getDatabasePath()}.`;
  }

  private key(sessionID: string): string {
    return TodoStore.sessionKey(sessionID);
  }

  /**
   * Resolves the key a session's rows currently live under.
   *
   * Prefers the real session id. A session first written by an older build
   * still sits under its hashed key, so that is checked as a fallback — without
   * it, upgrading would look like every todo list had vanished.
   */
  private resolveKey(sessionID: string): string {
    const handle = this.database();
    const key = this.key(sessionID);
    const found = handle.db
      .select({ sessionKey: todoSession.sessionKey })
      .from(todoSession)
      .where(eq(todoSession.sessionKey, key))
      .get();
    if (found) return key;

    const legacy = TodoStore.legacyKey(sessionID);
    const legacyFound = handle.db
      .select({ sessionKey: todoSession.sessionKey })
      .from(todoSession)
      .where(eq(todoSession.sessionKey, legacy))
      .get();
    return legacyFound ? legacy : key;
  }

  // Public read API

  /**
   * Reads a session's list.
   *
   * Synchronous at its core because `bun:sqlite` is synchronous; the `async`
   * signature is kept so existing callers do not need to change.
   */
  public async readTodos(sessionID: string): Promise<TodoRootItem[]> {
    return this.readTodosSync(sessionID);
  }

  public readTodosSync(sessionID: string): TodoRootItem[] {
    return selectTodos(this.database().db, this.resolveKey(sessionID));
  }

  public readTodoData(sessionID: string): TodoData | null {
    const handle = this.database();
    const key = this.resolveKey(sessionID);

    const session = handle.db
      .select()
      .from(todoSession)
      .where(eq(todoSession.sessionKey, key))
      .get();
    if (!session) return null;

    const todos = selectTodos(handle.db, key);
    return {
      version: session.revision,
      todos,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    };
  }

  /** Revision counter, used by the TUI to detect changes cheaply. */
  public getRevision(sessionID: string): number {
    return readRevision(this.database(), this.resolveKey(sessionID));
  }

  /**
   * Reads the hint marker value and, when it is stale, records the new
   * revision. Returns the previous revision so the caller can decide.
   */
  public takeHintRevision(sessionID: string, currentRevision: number): number {
    const handle = this.database();
    const key = this.resolveKey(sessionID);
    const session = handle.db
      .select({ hintRevision: todoSession.hintRevision })
      .from(todoSession)
      .where(eq(todoSession.sessionKey, key))
      .get();
    const previous = session?.hintRevision ?? 0;
    if (previous !== currentRevision) {
      handle.db
        .update(todoSession)
        .set({ hintRevision: currentRevision })
        .where(eq(todoSession.sessionKey, key))
        .run();
    }
    return previous;
  }

  /** Cross-process change signal for the TUI watcher. */
  public getDataVersion(): number {
    return readDataVersion(this.database().sqlite);
  }

  // Public write API

  public async writeTodos(
    sessionID: string,
    todos: TodoRootItem[],
  ): Promise<void> {
    await this.updateTodos(sessionID, () => todos);
  }

  public async updateTodos(
    sessionID: string,
    update: (todos: TodoRootItem[]) => TodoRootItem[],
  ): Promise<TodoRootItem[]> {
    const handle = this.database();
    const key = this.resolveKey(sessionID);

    // One transaction covers read, transform, and write. Splitting them would
    // allow a lost update when the tool process and the widget process write
    // concurrently: both could read revision N and then both write N+1.
    return mutateSessionTodos(handle, key, (current) => {
      const result = TodoTree.validateAndNormalize(update(current));
      if (!result.valid) {
        // Throwing inside the transaction rolls it back, so an invalid list
        // never reaches disk and never bumps the revision.
        throw new Error(result.error);
      }
      return result.data;
    }).todos;
  }

  /**
   * Drops the cached connection so the next call reopens from scratch.
   *
   * Only for tests: the store deliberately caches one connection per process
   * (opening applies migrations and sets up WAL, which is not free). A test
   * that points `OPENCODE_TODOS_DIR` at a new directory must reset, otherwise
   * the previous connection keeps servicing the old, unlinked file.
   */
  public resetForTests(): void {
    this.importedBaseDirs.clear();
    this.legacyDatabaseChecked = false;
    this.migration = { imported: [], skipped: [], failed: [] };
    // The only connection cache lives in `db.ts`, so closing it there is what
    // releases the file descriptor.
    resetDatabaseForTests();
  }
}

// Module-level singleton plus functional helpers for backward compatibility.

const defaultStore = new TodoStore();

export const getTodosDirectory = () => defaultStore.getTodosDirectory();
export const getDatabasePath = () => defaultStore.getDatabasePath();
export const sessionKey = (sessionID: string) =>
  TodoStore.sessionKey(sessionID);
export const readTodos = (sessionID: string) =>
  defaultStore.readTodos(sessionID);
export const readTodosSync = (sessionID: string) =>
  defaultStore.readTodosSync(sessionID);
export const writeTodos = (sessionID: string, todos: TodoRootItem[]) =>
  defaultStore.writeTodos(sessionID, todos);
export const updateTodos = (
  sessionID: string,
  update: (todos: TodoRootItem[]) => TodoRootItem[],
) => defaultStore.updateTodos(sessionID, update);
export const readTodoData = (sessionID: string) =>
  defaultStore.readTodoData(sessionID);
export const getRevision = (sessionID: string) =>
  defaultStore.getRevision(sessionID);
export const getMigrationReport = () => defaultStore.getMigrationReport();
export const getMigrationWarning = () => defaultStore.getMigrationWarning();
export const takeHintRevision = (sessionID: string, revision: number) =>
  defaultStore.takeHintRevision(sessionID, revision);
export const getDataVersion = () => defaultStore.getDataVersion();
export const resetTodoStoreForTests = () => defaultStore.resetForTests();
