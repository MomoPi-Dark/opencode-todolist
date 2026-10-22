import { readFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { TodoListSchema, type TodoRootItem } from "../schemas/todo";
import type { TodoDatabaseHandle } from "./db";
import { InvalidTodoDataError } from "./errors";
import { todoItem, todoSession } from "./schema";

/**
 * The transaction handle Drizzle passes to a `db.transaction` callback.
 *
 * Derived from the driver signature rather than named by hand, so it keeps
 * matching whatever the installed drizzle version actually provides.
 */
type Tx = Parameters<Parameters<TodoDatabaseHandle["db"]["transaction"]>[0]>[0];

/**
 * One-time import of the legacy per-session JSON files into SQLite, plus the
 * shared write primitive every caller uses.
 *
 * The old layout kept one file per session:
 *
 *   <base>/s_<hash>/todos/todos-<timestamp>.json
 *   <base>/s_<hash>/todos/version
 *
 * Design rules:
 *
 * - **Never delete data.** A file is renamed to `.json.migrated` only after the
 *   transaction committed, so a crash mid-import leaves the original intact.
 * - **Idempotent.** Importing a session that already holds rows is refused
 *   rather than merged, so a partial import cannot silently duplicate items.
 * - **Validated.** JSON is checked with the same `TodoListSchema` the tool
 *   uses, so a corrupt legacy file fails loudly here instead of producing a
 *   half-valid database.
 */

export interface MigrationResult {
  readonly imported: string[];
  readonly skipped: string[];
  readonly failed: { file: string; error: string }[];
}

const FILE_PREFIX = "todos-";
const FILE_SUFFIX = ".json";
const MIGRATED_SUFFIX = ".json.migrated";

/** Newest payload file wins, matching the old "latest wins" behaviour. */
export function findLegacyTodoFile(sessionDir: string): string | undefined {
  for (const dir of [join(sessionDir, "todos"), sessionDir]) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    const newest = names
      .filter(
        (name) => name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX),
      )
      .map((name) => ({
        path: join(dir, name),
        timestamp: Number(name.slice(FILE_PREFIX.length, -FILE_SUFFIX.length)),
      }))
      .filter(
        (entry) =>
          Number.isSafeInteger(entry.timestamp) && entry.timestamp >= 0,
      )
      .sort((left, right) => right.timestamp - left.timestamp)[0];
    if (newest) return newest.path;
  }
  return undefined;
}

/** Parses a legacy payload, accepting the wrapped object and the bare array. */
export function parseLegacyTodos(raw: string): TodoRootItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new InvalidTodoDataError(
      `invalid todo data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && "todos" in parsed
      ? (parsed as { todos: unknown }).todos
      : undefined;
  if (!Array.isArray(list)) {
    throw new InvalidTodoDataError("invalid todo data: todo list is missing");
  }

  const result = TodoListSchema.safeParse(list);
  if (!result.success) {
    throw new InvalidTodoDataError(
      `invalid todo data: ${result.error.issues
        .map((issue) => issue.message)
        .join(", ")}`,
    );
  }
  return result.data as TodoRootItem[];
}

/**
 * Replaces a session's whole list in one transaction.
 *
 * Used by both the importer and every normal write, so ordering (`position`)
 * and atomicity are identical everywhere.
 *
 * `behavior: "immediate"` takes the write lock before reading, so two
 * processes cannot both observe an old revision and then write rows that
 * conflict. Combined with `busy_timeout` the second writer waits instead of
 * failing.
 */
export function replaceSessionTodos(
  handle: TodoDatabaseHandle,
  sessionKey: string,
  todos: readonly TodoRootItem[],
): number {
  return handle.db.transaction(
    (tx: Tx) => writeSessionTodos(tx, sessionKey, todos),
    { behavior: "immediate" },
  );
}

/** Reads a session's revision, or 0 when the session has never been written. */
export function readRevision(
  handle: TodoDatabaseHandle,
  sessionKey: string,
): number {
  const row = handle.db
    .select({ revision: todoSession.revision })
    .from(todoSession)
    .where(eq(todoSession.sessionKey, sessionKey))
    .get();
  return row?.revision ?? 0;
}

/**
 * Read-modify-write under one `IMMEDIATE` transaction.
 *
 * Every write goes through here so the read, the caller's transform, and the
 * replacement cannot interleave with another process's write. Reading outside
 * the transaction and writing inside it would allow a lost update: two
 * processes could each read revision N, then both write revision N+1, and one
 * change would silently disappear.
 *
 * The transform receives the current list and returns the next one; validation
 * happens inside the transaction so an invalid result rolls the whole thing
 * back without bumping the revision.
 */
export function mutateSessionTodos(
  handle: TodoDatabaseHandle,
  sessionKey: string,
  transform: (current: TodoRootItem[]) => TodoRootItem[],
): { todos: TodoRootItem[]; revision: number } {
  return handle.db.transaction(
    (tx: Tx) => {
      const todos = selectTodos(tx, sessionKey);
      const next = transform(todos);
      const revision = writeSessionTodos(tx, sessionKey, next);
      return { todos: next, revision };
    },
    { behavior: "immediate" },
  );
}

/** Reads a session's list in `position` order, rebuilt into the nested shape. */
export function selectTodos(
  executor: Pick<TodoDatabaseHandle["db"], "select">,
  sessionKey: string,
): TodoRootItem[] {
  const rows = executor
    .select()
    .from(todoItem)
    .where(eq(todoItem.sessionKey, sessionKey))
    .orderBy(asc(todoItem.position))
    .all();

  const roots = new Map<string, TodoRootItem>();
  const order: string[] = [];

  for (const row of rows) {
    const base = {
      id: Number(row.id),
      content: row.content,
      status: row.status,
      ...(row.priority ? { priority: row.priority } : {}),
      ...(row.note !== null && row.note !== undefined ? { note: row.note } : {}),
    };

    if (row.parentId === null) {
      roots.set(row.id, base);
      order.push(row.id);
      continue;
    }
    const parent = roots.get(row.parentId);
    if (!parent) continue; // orphan; the foreign key prevents this
    parent.children ??= [];
    parent.children.push(base);
  }

  return order.map((id) => roots.get(id)!);
}

/**
 * Writes the full list for a session inside a transaction, without opening one.
 *
 * Kept separate so `mutateSessionTodos` can compose it with a read in the same
 * transaction.
 */
export function writeSessionTodos(
  tx: Pick<TodoDatabaseHandle["db"], "select" | "insert" | "update" | "delete">,
  sessionKey: string,
  todos: readonly TodoRootItem[],
): number {
  const now = new Date().toISOString();

  const existing = tx
    .select({
      revision: todoSession.revision,
      createdAt: todoSession.createdAt,
    })
    .from(todoSession)
    .where(eq(todoSession.sessionKey, sessionKey))
    .get();

  const revision = (existing?.revision ?? 0) + 1;
  const createdAt = existing?.createdAt ?? now;

  // A clear keeps the session row and still bumps the revision: the row holds
  // `revision` and `hint_revision`, so dropping it would reset the change
  // counter a reader polls and could re-emit an already-delivered hint. Only
  // the items are removed, which the delete below does for every write.
  if (existing) {
    tx.update(todoSession)
      .set({ revision, updatedAt: now })
      .where(eq(todoSession.sessionKey, sessionKey))
      .run();
  } else {
    tx.insert(todoSession)
      .values({ sessionKey, revision, createdAt, updatedAt: now })
      .run();
  }

  // Replace rather than diff: callers always supply the full list, and
  // delete-then-insert keeps `position` dense with no extra bookkeeping.
  tx.delete(todoItem).where(eq(todoItem.sessionKey, sessionKey)).run();

  let position = 0;
  const rows = todos.flatMap((root) => {
    const rootRow = {
      sessionKey,
      id: String(root.id),
      parentId: null as string | null,
      content: root.content,
      status: root.status,
      priority: root.priority ?? null,
      note: root.note ?? null,
      position: position++,
    };
    const childRows = (root.children ?? []).map((child) => ({
      sessionKey,
      id: String(child.id),
      parentId: String(root.id),
      content: child.content,
      status: child.status,
      priority: child.priority ?? null,
      note: child.note ?? null,
      position: position++,
    }));
    return [rootRow, ...childRows];
  });

  // Roots precede their children so the composite self-reference resolves
  // within the same transaction.
  if (rows.length > 0) tx.insert(todoItem).values(rows).run();

  return revision;
}

/**
 * Imports one session folder. Returns what happened so the caller can report
 * it; throws only on an unexpected filesystem error.
 */
function importSession(
  handle: TodoDatabaseHandle,
  sessionKey: string,
  sessionDir: string,
): "imported" | "skipped" | "empty" {
  const file = findLegacyTodoFile(sessionDir);
  if (!file) return "empty";

  const todos = parseLegacyTodos(readFileSync(file, "utf8"));

  // Refuse to merge into a session that already has rows: a second import
  // would duplicate items, and silently merging is worse than skipping.
  if (readRevision(handle, sessionKey) > 0) return "skipped";

  replaceSessionTodos(handle, sessionKey, todos);
  // Only now is it safe to mark the source as consumed.
  renameSync(file, file.replace(/\.json$/, MIGRATED_SUFFIX));
  return "imported";
}

/**
 * Scans every session folder under `baseDir` and imports the legacy JSON.
 *
 * Safe to run on every startup: sessions already present in SQLite are
 * skipped, and consumed files no longer match the payload pattern.
 */
export function importLegacyJson(
  handle: TodoDatabaseHandle,
  baseDir: string,
): MigrationResult {
  const result: MigrationResult = { imported: [], skipped: [], failed: [] };

  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch {
    return result;
  }

  for (const name of entries) {
    const sessionDir = join(baseDir, name);
    let file: string | undefined;
    try {
      file = findLegacyTodoFile(sessionDir);
      if (!file) continue;
    } catch {
      continue;
    }

    // The hashed folder name is the session key; the legacy plaintext layout
    // used the raw session id, which is also a valid key.
    const sessionKey = name;
    try {
      const outcome = importSession(handle, sessionKey, sessionDir);
      if (outcome === "imported") result.imported.push(file);
      else if (outcome === "skipped") result.skipped.push(file);
    } catch (error) {
      result.failed.push({
        file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
