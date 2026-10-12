import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import * as lockfile from "proper-lockfile";
import { TodoRootItemSchema, type TodoRootItem } from "../schema/todo.schema";
import { TodoTree } from "../todo/todo";
import { InvalidTodoDataError } from "./errors";

/**
 * Environment/OS context used to resolve storage locations. All fields are
 * optional so callers (and tests) can simulate any platform on any host.
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

interface SessionFile {
  path: string;
  timestamp: number;
}

/**
 * Per-session todo persistence.
 *
 * Layout (per session):
 *   <base>/s_<hash>/todos/todos-<timestamp>.json   todo payload (latest wins)
 *   <base>/s_<hash>/todos/version                  monotonically increasing version
 *   <base>/s_<hash>/todos/id                       hashed session folder name
 *   <base>/s_<hash>/todos/todos.lock               cross-process lock
 *   <base>/s_<hash>/todos/hint-marker.json         hint injection marker
 */
export class TodoStore {
  private static readonly SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
  private static readonly FILE_PREFIX = "todos-";
  private static readonly FILE_SUFFIX = ".json";

  constructor(private readonly ctx: PlatformContext = {}) { }

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
      throw new Error("[todo store] invalid session ID");
    }
    return normalized;
  }

  /**
   * Deterministic cryptographic hash of sessionID.
   * Produces an opaque 32-character hexadecimal folder name prefixed with "s_".
   * Prevents raw sessionIDs from leaking in the filesystem structure.
   */
  public static hashSessionID(sessionID: string): string {
    const normalized = TodoStore.normalizeSessionID(sessionID);
    const digest = createHash("sha256").update(normalized).digest("hex");
    return `s_${digest.slice(0, 32)}`;
  }

  private static async setPrivateMode(
    path: string,
    mode: number,
  ): Promise<void> {
    if (process.platform !== "win32") await chmod(path, mode);
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

  /**
   * Cross-platform home directory resolution.
   *
   * `os.homedir()` already adapts to the OS, but it can return an empty string
   * in stripped environments, and Windows shells sometimes expose a
   * POSIX-style `HOME` (e.g. Git Bash `/c/Users/...`). We therefore prefer the
   * canonical variable for the running platform before falling back.
   *
   * @see {@link https://nodejs.org/api/os.html#oshomedir}
   */
  public resolveHomeDir(): string {
    const { env, platform } = this;
    if (this.ctx.home) return this.ctx.home;

    if (platform === "win32") {
      // Windows: USERPROFILE is canonical; HOMEDRIVE+HOMEPATH is the legacy pair.
      if (env.USERPROFILE) return env.USERPROFILE;
      if (env.HOMEDRIVE && env.HOMEPATH)
        return `${env.HOMEDRIVE}${env.HOMEPATH}`;
      if (env.HOME) return env.HOME;
    } else {
      // Linux, macOS, BSD, etc.
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
   * Platform-native base directory for user configuration/data.
   *
   * - Windows : `%APPDATA%` (fallback `%LOCALAPPDATA%` → `~/AppData/Roaming`)
   * - macOS   : `~/Library/Application Support`
   * - Linux   : `$XDG_CONFIG_HOME` (fallback `~/.config`)
   *
   * `XDG_CONFIG_HOME` is honored first on every platform so users who prefer an
   * XDG layout (including those running OpenCode's own convention) can force it.
   */
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
   * Base directory that stores per-session todo folders.
   *
   * Priority:
   *   1. `OPENCODE_TODOS_DIR` — explicit plugin override (tests/tooling).
   *   2. The user's home directory + `.opencode/sessions`.
   */
  public resolveTodosBaseDir(): string {
    if (this.env.OPENCODE_TODOS_DIR) return this.env.OPENCODE_TODOS_DIR;
    return this.joinForPlatform(this.resolveHomeDir(), ".opencode", "sessions");
  }

  /** Base directory for all sessions (replaces the old `TODOS_DIRECTORY` const). */
  get todosRoot(): string {
    return this.getTodosDirectory();
  }

  // Path getters

  public getSessionDirectory(sessionID: string): string {
    const baseDir = this.resolveTodosBaseDir();
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);
    const hashedDir = join(baseDir, TodoStore.hashSessionID(safeSessionID));

    // Backward compatibility: if an unhashed legacy directory exists, prefer it
    // until it gets migrated or used.
    const legacyDir = join(baseDir, safeSessionID);
    if (!existsSync(hashedDir) && existsSync(legacyDir)) {
      return legacyDir;
    }

    return hashedDir;
  }

  public getTodosDirectory(sessionID?: string): string {
    const baseDir = this.resolveTodosBaseDir();
    if (!sessionID) return baseDir;
    return join(this.getSessionDirectory(sessionID), "todos");
  }

  public getTodoLockPath(sessionID: string): string {
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);
    return join(this.getTodosDirectory(safeSessionID), "todos.lock");
  }

  public getHintMarkerPath(sessionID: string): string {
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);
    return join(this.getTodosDirectory(safeSessionID), "hint-marker.json");
  }

  public getSessionIDFilePath(sessionID: string): string {
    return join(
      this.getTodosDirectory(TodoStore.normalizeSessionID(sessionID)),
      "id",
    );
  }

  public getVersionFilePath(sessionID: string): string {
    return join(
      this.getTodosDirectory(TodoStore.normalizeSessionID(sessionID)),
      "version",
    );
  }

  public getTodoFilePath(sessionID: string): string {
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);
    return (
      this.listSessionFiles(safeSessionID)[0]?.path ??
      join(this.getTodosDirectory(safeSessionID), `todos-${Date.now()}.json`)
    );
  }

  // Public read API

  public async readTodos(sessionID: string): Promise<TodoRootItem[]> {
    const filePath = this.getTodoFilePath(sessionID);
    try {
      return TodoStore.parseTodoFile(await readFile(filePath, "utf8"));
    } catch (error) {
      return this.recoverFromReadError(error);
    }
  }

  public readTodosSync(sessionID: string): TodoRootItem[] {
    const filePath = this.getTodoFilePath(sessionID);
    try {
      return TodoStore.parseTodoFile(readFileSync(filePath, "utf8"));
    } catch (error) {
      return this.recoverFromReadError(error);
    }
  }

  public readTodoData(sessionID: string): TodoData | null {
    try {
      const safeSessionID = TodoStore.normalizeSessionID(sessionID);
      const raw = readFileSync(this.getTodoFilePath(safeSessionID), "utf8");

      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;

      const data = parsed as Record<string, unknown>;
      const todos = (
        Array.isArray(data.todos)
          ? data.todos
          : Array.isArray(parsed)
            ? parsed
            : []
      ) as TodoRootItem[];
      const legacyVersion =
        typeof data.version === "number" && Number.isSafeInteger(data.version)
          ? data.version
          : 0;
      const legacyCreatedAt =
        typeof data.createdAt === "string" ? data.createdAt : undefined;
      const legacyUpdatedAt =
        typeof data.updatedAt === "string" ? data.updatedAt : undefined;
      const updated_at =
        typeof data.updated_at === "string"
          ? data.updated_at
          : (legacyUpdatedAt ?? new Date().toISOString());
      const created_at =
        typeof data.created_at === "string"
          ? data.created_at
          : (legacyCreatedAt ?? legacyUpdatedAt ?? updated_at);

      return {
        version: this.readVersionFile(safeSessionID) ?? legacyVersion,
        todos,
        created_at,
        updated_at,
      };
    } catch {
      return null;
    }
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
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);
    const baseDir = this.getTodosDirectory();
    const legacyDir = join(baseDir, safeSessionID);
    const targetDir = join(baseDir, TodoStore.hashSessionID(safeSessionID));

    // Migrate legacy plaintext directories to hashed ones.
    if (existsSync(legacyDir) && !existsSync(targetDir)) {
      try {
        await rename(legacyDir, targetDir);
      } catch {
        // Fallback: if rename fails (e.g. cross-device), continue using legacyDir
      }
    }

    const sessionRoot = this.getSessionDirectory(safeSessionID);
    const sessionDir = this.getTodosDirectory(safeSessionID);
    await mkdir(sessionDir, { recursive: true });
    await TodoStore.setPrivateMode(sessionRoot, 0o700);
    await TodoStore.setPrivateMode(sessionDir, 0o700);
    await this.migrateFlatTodoFiles(sessionRoot, sessionDir);

    const release = await lockfile.lock(this.getTodoFilePath(safeSessionID), {
      realpath: false,
      lockfilePath: this.getTodoLockPath(safeSessionID),
      retries: { retries: 10, minTimeout: 10, maxTimeout: 250 },
      stale: 10_000,
    });

    try {
      const filePath = this.getTodoFilePath(safeSessionID);
      let current: TodoRootItem[];

      try {
        current = await this.readTodos(safeSessionID);
      } catch (error) {
        if (!(error instanceof InvalidTodoDataError)) throw error;

        // Archive the corrupt file and start from an empty list.
        const archivedPath = `${filePath}.corrupt-${Date.now()}`;
        const archived = await rename(filePath, archivedPath).then(
          () => true,
          () => false,
        );
        if (archived) await TodoStore.setPrivateMode(archivedPath, 0o600);
        current = [];
      }

      const result = new TodoTree(update(current)).validateAndNormalize();
      if (!result.valid) {
        throw new Error(`[todo store validation failed] ${result.error}`);
      }

      const existingData = this.readTodoData(safeSessionID);
      const now = new Date().toISOString();
      const nextVersion = (existingData?.version ?? 0) + 1;
      const payload: Omit<TodoData, "version"> = {
        created_at: existingData?.created_at ?? now,
        updated_at: now,
        todos: result.data,
      };

      await this.writeJsonAtomically(filePath, payload);
      await this.writeTextAtomically(
        this.getVersionFilePath(safeSessionID),
        `${nextVersion}\n`,
      );
      await this.writeTextAtomically(
        this.getSessionIDFilePath(safeSessionID),
        `${TodoStore.hashSessionID(safeSessionID)}\n`,
      );
      await rm(join(sessionDir, "session.json"), { force: true });
      await rm(join(sessionRoot, "session.json"), { force: true });

      return result.data;
    } finally {
      await release();
    }
  }

  // Internals

  private scanTodoFiles(directory: string, prefix: string): SessionFile[] {
    const suffix = TodoStore.FILE_SUFFIX;
    return readdirSync(directory)
      .flatMap((name) => {
        if (!name.startsWith(prefix) || !name.endsWith(suffix)) return [];
        const timestamp = Number(name.slice(prefix.length, -suffix.length));
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) return [];
        return [{ path: join(directory, name), timestamp }];
      })
      .sort((left, right) => right.timestamp - left.timestamp);
  }

  private listSessionFiles(sessionID: string): SessionFile[] {
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);
    const sessionDirs = [
      this.getTodosDirectory(safeSessionID),
      this.getSessionDirectory(safeSessionID),
    ].filter((directory, index, all) => all.indexOf(directory) === index);

    for (const sessionDir of sessionDirs) {
      try {
        const files = this.scanTodoFiles(sessionDir, TodoStore.FILE_PREFIX);
        if (files.length > 0) return files;
      } catch (error) {
        if (!TodoStore.isMissingFile(error)) throw error;
      }
    }

    // Oldest layout: flat files in the base directory, `todos-<sessionID>-<ts>.json`.
    try {
      return this.scanTodoFiles(
        this.getTodosDirectory(),
        `${TodoStore.FILE_PREFIX}${safeSessionID}-`,
      );
    } catch (error) {
      if (TodoStore.isMissingFile(error)) return [];
      throw error;
    }
  }

  private readVersionFile(sessionID: string): number | null {
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);
    const paths = [
      this.getVersionFilePath(safeSessionID),
      join(this.getSessionDirectory(safeSessionID), "version"),
    ];
    for (const path of paths) {
      try {
        const version = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
        if (Number.isSafeInteger(version) && version >= 0) return version;
      } catch {
        // try the next candidate
      }
    }
    return null;
  }

  private static parseTodoFile(raw: string): TodoRootItem[] {
    try {
      const parsed: unknown = JSON.parse(raw);
      const list = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null && "todos" in parsed
          ? parsed.todos
          : undefined;
      if (!Array.isArray(list)) throw new Error("todo list is missing");

      const result = TodoRootItemSchema.array().safeParse(list);
      if (!result.success) {
        throw new Error(result.error.issues.map((i) => i.message).join(", "));
      }
      return result.data as TodoRootItem[];
    } catch (err) {
      throw new InvalidTodoDataError(
        `[todo store read failed] invalid todo data: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Shared error policy for readTodos / readTodosSync. */
  private recoverFromReadError(error: unknown): TodoRootItem[] {
    if (TodoStore.isMissingFile(error)) return [];
    if (error instanceof InvalidTodoDataError) throw error;
    throw new Error(
      `[todo store read failed] unable to read todo storage: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  private async writeTextAtomically(
    filePath: string,
    content: string,
  ): Promise<void> {
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, filePath);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async writeJsonAtomically(
    filePath: string,
    data: unknown,
  ): Promise<void> {
    await this.writeTextAtomically(
      filePath,
      `${JSON.stringify(data, null, 2)}\n`,
    );
  }

  private async migrateFlatTodoFiles(
    sessionRoot: string,
    todosDir: string,
  ): Promise<void> {
    let names: string[];
    try {
      names = readdirSync(sessionRoot);
    } catch (error) {
      if (TodoStore.isMissingFile(error)) return;
      throw error;
    }

    const movable = new Set([
      "id",
      "version",
      "todos.lock",
      "hint-marker.json",
    ]);
    for (const name of names) {
      const isTodoFile =
        name.startsWith(TodoStore.FILE_PREFIX) &&
        name.endsWith(TodoStore.FILE_SUFFIX);
      if (!isTodoFile && !movable.has(name)) continue;

      const to = join(todosDir, name);
      if (existsSync(to)) continue;
      await rename(join(sessionRoot, name), to).catch(() => { });
    }
  }
}

// Module-level singletons / functional helpers for backward-compatibility
const defaultStore = new TodoStore();

export const getTodosDirectory = (sessionID?: string) =>
  defaultStore.getTodosDirectory(sessionID);
export const hashSessionID = (sessionID: string) =>
  TodoStore.hashSessionID(sessionID);
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
export const getHintMarkerPath = (sessionID: string) =>
  defaultStore.getHintMarkerPath(sessionID);
