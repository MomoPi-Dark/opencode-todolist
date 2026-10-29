import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { posix, win32 } from "node:path";
import type { TodoRootItem } from "../schemas/todo/item";
import { TodoTree } from "../todos/todotree";
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
import { todoSession } from "./tables";

/**
 * Per-session todo persistence on SQLite using plain functional API.
 */

export interface PlatformContext {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  home?: string;
}

interface TodoData {
  version: number;
  todos: TodoRootItem[];
  created_at: string;
  updated_at: string;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const FILE_NAME = "todos.db";

// Static string helpers

export function normalizeSessionID(sessionID: string): string {
  const normalized = sessionID.trim();
  if (!SESSION_ID_PATTERN.test(normalized)) {
    throw new Error("invalid session ID");
  }
  return normalized;
}

export function legacyKey(sessionID: string): string {
  const digest = createHash("sha256")
    .update(normalizeSessionID(sessionID))
    .digest("hex");
  return `s_${digest.slice(0, 32)}`;
}

// Factory function encapsulating platform context and migration state

export function createTodoStore(ctx: PlatformContext = {}) {
  const importedBaseDirs = new Set<string>();
  let legacyDatabaseChecked = false;
  let migrationState: MigrationResult = {
    imported: [],
    skipped: [],
    failed: [],
  };

  const env = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;
  const pathApi = platform === "win32" ? win32 : posix;

  function resolveHome(): string {
    if (ctx.home) return ctx.home;

    const { HOME, USERPROFILE, HOMEDRIVE, HOMEPATH } = env;
    const drivePath =
      HOMEDRIVE && HOMEPATH ? `${HOMEDRIVE}${HOMEPATH}` : undefined;
    const found =
      platform === "win32"
        ? USERPROFILE || drivePath || HOME
        : HOME || USERPROFILE;
    if (found) return found;

    try {
      return homedir();
    } catch {
      return tmpdir();
    }
  }

  function resolveTodosBase(): string {
    const override = env.OPENCODE_TODOS_DIR;
    if (override) {
      if (!pathApi.isAbsolute(override)) {
        throw new Error("OPENCODE_TODOS_DIR must be an absolute path");
      }
      return override;
    }
    const xdg = env.XDG_DATA_HOME;
    if (xdg && pathApi.isAbsolute(xdg)) {
      return pathApi.join(xdg, "opencode", "todolist");
    }
    return pathApi.join(
      resolveHome(),
      ".local",
      "share",
      "opencode",
      "todolist",
    );
  }

  function resolveLegacyDirs(): string[] {
    const home = resolveHome();
    return [
      pathApi.join(home, ".opencode", "sessions"),
      pathApi.join(home, ".opencode", "session"),
    ];
  }

  function resolveLegacyDir(): string {
    return resolveLegacyDirs()[0]!;
  }

  function getDbPath(): string {
    return pathApi.join(resolveTodosBase(), FILE_NAME);
  }

  function getDatabaseHandle(): TodoDatabaseHandle {
    const overridden = Boolean(env.OPENCODE_TODOS_DIR);
    const dbPath = getDbPath();

    if (!overridden && !legacyDatabaseChecked) {
      for (const legacyDir of resolveLegacyDirs()) {
        try {
          const adopted = adoptLegacyDatabase(legacyDir, dbPath);
          if (adopted) {
            migrationState.imported.push(adopted);
            break;
          }
        } catch (error) {
          const file = pathApi.join(legacyDir, FILE_NAME);
          if (!migrationState.failed.some((entry) => entry.file === file)) {
            migrationState.failed.push({
              file,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          throw error;
        }
      }
      legacyDatabaseChecked = true;
    }

    const handle = getDatabase(dbPath);

    const baseDirs = overridden
      ? [resolveTodosBase()]
      : [resolveTodosBase(), ...resolveLegacyDirs()];
    for (const baseDir of new Set(baseDirs)) {
      if (importedBaseDirs.has(baseDir)) continue;
      const result = importLegacyJson(handle, baseDir);
      migrationState.imported.push(...result.imported);
      migrationState.skipped.push(...result.skipped);
      migrationState.failed.push(...result.failed);
      importedBaseDirs.add(baseDir);
    }
    return handle;
  }

  function getReport(): MigrationResult {
    try {
      getDatabaseHandle();
    } catch {
      // Gagal membuka DB tetap menghasilkan laporan; error-nya sudah tercatat
      // di migrationState.failed oleh getDatabaseHandle.
    }
    return {
      imported: [...migrationState.imported],
      skipped: [...migrationState.skipped],
      failed: [...migrationState.failed],
    };
  }

  function getWarning(): string | undefined {
    const { failed } = getReport();
    if (failed.length === 0) return undefined;

    const names = failed.map((entry) => entry.file).join(", ");
    return `Todo upgrade incomplete: ${failed.length} legacy file(s) could not be imported (${names}). They are still in ${resolveLegacyDir()}; fix or import them by hand. Everything else migrated to ${getDbPath()}.`;
  }

  /** Prefers the plain key, falls back to the hashed legacy key if only that exists. */
  function resolveSessionKey(sessionID: string): string {
    const { db } = getDatabaseHandle();
    const exists = (key: string) =>
      Boolean(
        db
          .select({ sessionKey: todoSession.sessionKey })
          .from(todoSession)
          .where(eq(todoSession.sessionKey, key))
          .get(),
      );

    const key = normalizeSessionID(sessionID);
    if (exists(key)) return key;

    const legacy = legacyKey(sessionID);
    return exists(legacy) ? legacy : key;
  }

  function readSync(sessionID: string): TodoRootItem[] {
    return selectTodos(getDatabaseHandle().db, resolveSessionKey(sessionID));
  }

  const read = async (sessionID: string): Promise<TodoRootItem[]> =>
    readSync(sessionID);

  function readData(sessionID: string): TodoData | null {
    const handle = getDatabaseHandle();
    const key = resolveSessionKey(sessionID);

    const session = handle.db
      .select()
      .from(todoSession)
      .where(eq(todoSession.sessionKey, key))
      .get();
    if (!session) return null;

    return {
      version: session.revision,
      todos: selectTodos(handle.db, key),
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    };
  }

  function revision(sessionID: string): number {
    return readRevision(getDatabaseHandle(), resolveSessionKey(sessionID));
  }

  function takeHint(sessionID: string, currentRevision: number): number {
    const { db } = getDatabaseHandle();
    const key = resolveSessionKey(sessionID);
    const session = db
      .select({ hintRevision: todoSession.hintRevision })
      .from(todoSession)
      .where(eq(todoSession.sessionKey, key))
      .get();
    const previous = session?.hintRevision ?? 0;
    if (previous !== currentRevision) {
      db.update(todoSession)
        .set({ hintRevision: currentRevision })
        .where(eq(todoSession.sessionKey, key))
        .run();
    }
    return previous;
  }

  function dataVer(): number {
    return readDataVersion(getDatabaseHandle().sqlite);
  }

  async function update(
    sessionID: string,
    mutation: (todos: TodoRootItem[]) => TodoRootItem[],
  ): Promise<TodoRootItem[]> {
    const handle = getDatabaseHandle();
    const key = resolveSessionKey(sessionID);

    return mutateSessionTodos(handle, key, (current) => {
      const result = TodoTree.validateAndNormalize(mutation(current));
      if (!result.valid) throw new Error(result.error);
      return result.data;
    }).todos;
  }

  async function write(
    sessionID: string,
    todos: TodoRootItem[],
  ): Promise<void> {
    await update(sessionID, () => todos);
  }

  function reset(): void {
    importedBaseDirs.clear();
    legacyDatabaseChecked = false;
    migrationState = { imported: [], skipped: [], failed: [] };
    resetDatabaseForTests();
  }

  return {
    resolveHomeDir: resolveHome,
    resolveTodosBaseDir: resolveTodosBase,
    resolveLegacyBaseDirs: resolveLegacyDirs,
    resolveLegacyBaseDir: resolveLegacyDir,
    getDatabasePath: getDbPath,
    getMigrationReport: getReport,
    getMigrationWarning: getWarning,
    readTodos: read,
    readTodosSync: readSync,
    readTodoData: readData,
    getRevision: revision,
    takeHintRevision: takeHint,
    getDataVersion: dataVer,
    writeTodos: write,
    updateTodos: update,
    resetForTests: reset,
  };
}

// Module-level default store instance

let defaultStore = createTodoStore();

/** Uses a fresh store when a context is given, otherwise the shared default. */
const storeFor = (ctx?: PlatformContext) =>
  ctx ? createTodoStore(ctx) : defaultStore;

// Direct functional exports

export const resolveHomeDir = (ctx?: PlatformContext) =>
  storeFor(ctx).resolveHomeDir();

export const resolveTodosBaseDir = (ctx?: PlatformContext) =>
  storeFor(ctx).resolveTodosBaseDir();

export const resolveLegacyBaseDirs = (ctx?: PlatformContext) =>
  storeFor(ctx).resolveLegacyBaseDirs();

export const resolveLegacyBaseDir = (ctx?: PlatformContext) =>
  storeFor(ctx).resolveLegacyBaseDir();

export const getDatabasePath = (ctx?: PlatformContext) =>
  storeFor(ctx).getDatabasePath();

export const getMigrationReport = (ctx?: PlatformContext): MigrationResult =>
  storeFor(ctx).getMigrationReport();

export const getMigrationWarning = (ctx?: PlatformContext) =>
  storeFor(ctx).getMigrationWarning();

export const readTodos = (sessionID: string, ctx?: PlatformContext) =>
  storeFor(ctx).readTodos(sessionID);

export const readTodosSync = (sessionID: string, ctx?: PlatformContext) =>
  storeFor(ctx).readTodosSync(sessionID);

export const readTodoData = (sessionID: string, ctx?: PlatformContext) =>
  storeFor(ctx).readTodoData(sessionID);

export const getRevision = (sessionID: string, ctx?: PlatformContext) =>
  storeFor(ctx).getRevision(sessionID);

export const takeHintRevision = (
  sessionID: string,
  currentRevision: number,
  ctx?: PlatformContext,
) => storeFor(ctx).takeHintRevision(sessionID, currentRevision);

export const getDataVersion = (ctx?: PlatformContext) =>
  storeFor(ctx).getDataVersion();

export const writeTodos = (
  sessionID: string,
  todos: TodoRootItem[],
  ctx?: PlatformContext,
) => storeFor(ctx).writeTodos(sessionID, todos);

export const updateTodos = (
  sessionID: string,
  update: (todos: TodoRootItem[]) => TodoRootItem[],
  ctx?: PlatformContext,
) => storeFor(ctx).updateTodos(sessionID, update);

export function resetTodoStoreForTests(): void {
  defaultStore = createTodoStore();
  resetDatabaseForTests();
}
