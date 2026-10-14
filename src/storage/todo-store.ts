import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { eq } from "drizzle-orm";
import type { TodoRootItem } from "../schemas/todo";
import { TodoTree } from "../todos/todo-tree";
import {
  getDatabase,
  getDataVersion as readDataVersion,
  resetDatabaseForTests,
  resolveMigrationsFolder,
  type TodoDatabaseHandle,
} from "./db";
import {
  importLegacyJson,
  mutateSessionTodos,
  readRevision,
  replaceSessionTodos,
  selectTodos,
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

  private handle: TodoDatabaseHandle | undefined;
  private importedBaseDir: string | undefined;

  constructor(private readonly ctx: PlatformContext = {}) {}

  // Static helpers

  public static isMissingFile(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    );
  }

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

  public resolveConfigHome(): string {
    const { env, platform } = this;
    if (env.XDG_CONFIG_HOME) return env.XDG_CONFIG_HOME;

    if (platform === "win32") {
      if (env.APPDATA) return env.APPDATA;
      if (env.LOCALAPPDATA) return env.LOCALAPPDATA;
      return this.joinForPlatform(this.resolveHomeDir(), "AppData", "Roaming");
    }

    if (platform === "darwin") {
      return this.joinForPlatform(
        this.resolveHomeDir(),
        "Library",
        "Application Support",
      );
    }

    return this.joinForPlatform(this.resolveHomeDir(), ".config");
  }

  /**
   * Base directory holding the database and the legacy session folders.
   *
   * Priority:
   *   1. `OPENCODE_TODOS_DIR` — explicit override for tests and tooling.
   *   2. `<home>/.opencode/sessions`
   */
  public resolveTodosBaseDir(): string {
    if (this.env.OPENCODE_TODOS_DIR) return this.env.OPENCODE_TODOS_DIR;
    return this.joinForPlatform(this.resolveHomeDir(), ".opencode", "sessions");
  }

  get todosRoot(): string {
    return this.getTodosDirectory();
  }

  public getDatabasePath(): string {
    return this.joinForPlatform(this.resolveTodosBaseDir(), FILE_NAME);
  }

  /**
   * Legacy per-session directory.
   *
   * No longer written to. Kept because it is still read once to import old JSON
   * and because the TUI watches this directory for filesystem changes.
   */
  public getSessionDirectory(sessionID: string): string {
    const baseDir = this.resolveTodosBaseDir();
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);
    const hashedDir = join(baseDir, TodoStore.hashSessionID(safeSessionID));
    const legacyDir = join(baseDir, safeSessionID);
    if (!existsSync(hashedDir) && existsSync(legacyDir)) return legacyDir;
    return hashedDir;
  }

  public getTodosDirectory(sessionID?: string): string {
    const baseDir = this.resolveTodosBaseDir();
    if (!sessionID) return baseDir;
    return join(this.getSessionDirectory(sessionID), "todos");
  }

  /**
   * Path of the legacy hint marker.
   *
   * The marker now lives in `todo_session.hint_revision`, so nothing writes
   * here. The path is still exposed because callers may need to locate and
   * clean up a leftover file from an older install.
   */
  public getHintMarkerPath(sessionID: string): string {
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);
    return join(this.getTodosDirectory(safeSessionID), "hint-marker.json");
  }

  // Connection

  private database(): TodoDatabaseHandle {
    if (!this.handle) {
      this.handle = getDatabase(this.getDatabasePath());
    }
    // Import legacy JSON once per base directory for this process.
    const baseDir = this.resolveTodosBaseDir();
    if (this.importedBaseDir !== baseDir) {
      importLegacyJson(this.handle, baseDir);
      this.importedBaseDir = baseDir;
    }
    return this.handle;
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

  public migrationsFolder(): string {
    return resolveMigrationsFolder();
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
      const result = new TodoTree(update(current)).validateAndNormalize();
      if (!result.valid) {
        // Throwing inside the transaction rolls it back, so an invalid list
        // never reaches disk and never bumps the revision.
        throw new Error(result.error);
      }
      return result.data;
    }).todos;
  }

  /** Replaces a list without running the tree validation (import path). */
  public replaceTodosSync(sessionID: string, todos: TodoRootItem[]): void {
    replaceSessionTodos(this.database(), this.resolveKey(sessionID), todos);
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
    this.handle = undefined;
    this.importedBaseDir = undefined;
    // The connection itself is cached in `db.ts`, so closing it there is what
    // actually releases the old file descriptor.
    resetDatabaseForTests();
  }
}

// Module-level singleton plus functional helpers for backward compatibility.

const defaultStore = new TodoStore();

export const getTodosDirectory = (sessionID?: string) =>
  defaultStore.getTodosDirectory(sessionID);
export const getDatabasePath = () => defaultStore.getDatabasePath();
export const sessionKey = (sessionID: string) => TodoStore.sessionKey(sessionID);
export const legacySessionKey = (sessionID: string) =>
  TodoStore.legacyKey(sessionID);
/** @deprecated Use {@link legacySessionKey}; the hash is no longer the key. */
export const hashSessionID = (sessionID: string) =>
  TodoStore.hashSessionID(sessionID);
export const readTodos = (sessionID: string) => defaultStore.readTodos(sessionID);
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
export const getHintMarkerPath = (sessionID: string) =>
  defaultStore.getHintMarkerPath(sessionID);
export const getRevision = (sessionID: string) =>
  defaultStore.getRevision(sessionID);
export const takeHintRevision = (sessionID: string, revision: number) =>
  defaultStore.takeHintRevision(sessionID, revision);
export const getDataVersion = () => defaultStore.getDataVersion();
export const resetTodoStoreForTests = () => defaultStore.resetForTests();
