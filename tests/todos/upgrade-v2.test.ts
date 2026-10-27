import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { openDatabase, resetDatabaseForTests } from "../../src/storage/db";
import { TodoStore } from "../../src/storage/todo-store";

/**
 * Version 2 upgrade path.
 *
 * Two different layouts existed before SQLite became the only writer:
 *
 *   1. `<home>/.opencode/sessions/s_<hash>/todos/todos-<ts>.json`
 *      plus the newer plaintext `<home>/.opencode/sessions/<sessionId>/todos/`
 *   2. a single `<home>/.opencode/sessions/todos.db` (or its pre-v2 copy that
 *      an earlier build already renamed to `todos.db.migrated`)
 *
 * Both must land in `<home>/.local/share/opencode/todolist/todos.db`. The rules
 * under test are the ones that keep this safe:
 *
 * - nothing is deleted; consumed sources are renamed, never removed
 * - a copy is verified before the source is marked as consumed
 * - an unreadable source is reported, not swallowed
 */

const dirs: string[] = [];
const root = (id: number, extra: Partial<TodoRootItem> = {}): TodoRootItem => ({
    id,
    content: `Task ${id}`,
    status: "pending",
    ...extra,
});

const tmp = (prefix = "todo-v2-"): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
};

const storeAtHome = (home: string): TodoStore => new TodoStore({ env: {}, home });

const newDb = (home: string): string =>
    join(home, ".local", "share", "opencode", "todolist", "todos.db");

/** Writes a legacy per-session JSON payload the way the old store did. */
const writeLegacyJson = (
    home: string,
    sessionID: string,
    todos: TodoRootItem[],
    layout: "hashed" | "plain",
): string => {
    const base = join(home, ".opencode", "sessions");
    // The hashed layout used `TodoStore.legacyKey`, not an arbitrary name.
    const dir = join(
        base,
        layout === "hashed" ? TodoStore.legacyKey(sessionID) : sessionID,
        "todos",
    );
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "todos-1700000000000.json");
    writeFileSync(file, JSON.stringify({ todos }));
    return file;
};

afterEach(() => {
    resetDatabaseForTests();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("v2 upgrade", () => {
    test("imports a hashed per-session JSON file", async () => {
        const home = tmp();
        const file = writeLegacyJson(home, "session-a", [root(1)], "hashed");

        const store = storeAtHome(home);
        expect(await store.readTodos("session-a")).toEqual([root(1)]);
        expect(existsSync(file)).toBe(false);
        expect(existsSync(`${file}.migrated`)).toBe(true);
    });

    test("imports a plaintext per-session JSON file", async () => {
        const home = tmp();
        // The readable layout: folder named exactly like the session id.
        const dir = join(home, ".opencode", "sessions", "session-a", "todos");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "todos-1700000000000.json");
        writeFileSync(
            file,
            JSON.stringify({ todos: [root(2, { status: "in_progress" })] }),
        );

        const store = storeAtHome(home);
        expect(await store.readTodos("session-a")).toEqual([
            root(2, { status: "in_progress" }),
        ]);
        expect(existsSync(`${file}.migrated`)).toBe(true);
    });

    test("imports the pre-v2 migrated SQLite copy", async () => {
        const home = tmp();
        const legacyDir = join(home, ".opencode", "sessions");
        mkdirSync(legacyDir, { recursive: true });
        const copy = join(legacyDir, "todos.db.migrated");

        // Build a database the way an earlier build would have left it.
        const source = openDatabase(copy);
        try {
            source.sqlite.run(
                "INSERT INTO todo_session (session_key, created_at, updated_at) VALUES ('session-a', 'now', 'now')",
            );
            source.sqlite.run(
                "INSERT INTO todo_item (session_key, id, parent_id, content, status, position) VALUES ('session-a', '1', NULL, 'Task 9', 'completed', 0)",
            );
        } finally {
            source.sqlite.close();
        }

        const store = storeAtHome(home);
        expect(await store.readTodos("session-a")).toEqual([
            root(1, { content: "Task 9", status: "completed" }),
        ]);
        // The pre-v2 copy is a source like any other: consumed, never deleted.
        expect(existsSync(copy)).toBe(true);
        expect(existsSync(newDb(home))).toBe(true);
    });

    test("does not import the same JSON twice", async () => {
        const home = tmp();
        writeLegacyJson(home, "session-a", [root(1)], "plain");

        const first = storeAtHome(home);
        await first.readTodos("session-a");
        resetDatabaseForTests();

        // Recreate the source file with different content, as if a stale
        // backup had been restored. The session already has rows, so it is
        // skipped rather than merged.
        const dir = join(home, ".opencode", "sessions", "session-a", "todos");
        const file = join(dir, "todos-1700000000000.json");
        writeFileSync(file, JSON.stringify({ todos: [root(7)] }));

        const second = storeAtHome(home);
        expect(await second.readTodos("session-a")).toEqual([root(1)]);
        expect(existsSync(file)).toBe(true);
    });

    test("leaves the source untouched when its payload is corrupt", async () => {
        const home = tmp();
        const dir = join(home, ".opencode", "sessions", "session-a", "todos");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "todos-1700000000000.json");
        writeFileSync(file, "{ this is not json");

        const store = storeAtHome(home);

        // A corrupt file must not be silently swallowed: the upgrade reports it
        // so the user can fix it instead of wondering where the list went.
        expect(await store.readTodos("session-a")).toEqual([]);
        expect(existsSync(file)).toBe(true);
        expect(store.getMigrationReport().failed.map((entry) => entry.file)).toContain(
            file,
        );
    });

    test("reports what it imported, skipped, and failed", async () => {
        const home = tmp();
        writeLegacyJson(home, "session-a", [root(1)], "plain");
        const corruptDir = join(home, ".opencode", "sessions", "broken", "todos");
        mkdirSync(corruptDir, { recursive: true });
        writeFileSync(join(corruptDir, "todos-1700000000000.json"), "nope");

        const store = storeAtHome(home);
        await store.readTodos("session-a");

        const report = store.getMigrationReport();
        expect(report.imported.length).toBe(1);
        expect(report.failed.length).toBe(1);
        expect(report.failed[0]?.file).toContain("broken");
    });

    test("is idempotent: a second process sees the same rows", async () => {
        const home = tmp();
        writeLegacyJson(home, "session-a", [root(1)], "plain");

        const first = storeAtHome(home);
        await first.readTodos("session-a");
        resetDatabaseForTests();

        const second = storeAtHome(home);
        expect(await second.readTodos("session-a")).toEqual([root(1)]);
        resetDatabaseForTests();

        const third = storeAtHome(home);
        expect(await third.readTodos("session-a")).toEqual([root(1)]);
    });

    test("nothing is left behind in the old directory", async () => {
        const home = tmp();
        const file = writeLegacyJson(home, "session-a", [root(1)], "plain");
        const legacyDir = join(home, ".opencode", "sessions");

        const store = storeAtHome(home);
        await store.readTodos("session-a");

        const leftovers = readdirSync(legacyDir, { recursive: true })
            .map(String)
            .filter((name) => name.endsWith(".json"));
        // Only consumed markers may remain; no live payload is orphaned.
        expect(leftovers).toEqual([]);
        expect(existsSync(file)).toBe(false);
    });

    test("a failed upgrade is not silent: it yields a warning to show the user", async () => {
        const home = tmp();
        const dir = join(home, ".opencode", "sessions", "session-a", "todos");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "todos-1700000000000.json");
        writeFileSync(file, "not json at all");

        const store = storeAtHome(home);
        await store.readTodos("session-a");

        const warning = store.getMigrationWarning();
        expect(warning).toBeDefined();
        expect(warning).toContain(".opencode/sessions");
        // The user must be able to find the file that needs attention.
        expect(warning).toContain("todos-1700000000000.json");
    });

    test("a clean upgrade yields no warning", async () => {
        const home = tmp();
        writeLegacyJson(home, "session-a", [root(1)], "plain");

        const store = storeAtHome(home);
        await store.readTodos("session-a");

        expect(store.getMigrationWarning()).toBeUndefined();
    });

    test("imports from singular .opencode/session/todos/<sessionId>/todos-*.json", async () => {
        const home = tmp();
        const dir = join(home, ".opencode", "session", "todos", "session-a");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "todos-1700000000000.json");
        writeFileSync(file, JSON.stringify({ todos: [root(3, { status: "completed" })] }));

        const store = storeAtHome(home);
        expect(await store.readTodos("session-a")).toEqual([
            root(3, { status: "completed" }),
        ]);
        expect(existsSync(`${file}.migrated`)).toBe(true);
    });

    test("blocks and does not create an empty DB when legacy SQLite migration fails", async () => {
        const home = tmp();
        const legacyDir = join(home, ".opencode", "sessions");
        mkdirSync(legacyDir, { recursive: true });
        const legacyDb = join(legacyDir, "todos.db");
        writeFileSync(legacyDb, "corrupt sqlite header");

        const store = storeAtHome(home);
        await expect(store.readTodos("session-a")).rejects.toThrow();
        // Crucial: must NOT create a blank new DB that would permanently skip future retries.
        expect(existsSync(newDb(home))).toBe(false);
        expect(existsSync(legacyDb)).toBe(true);
        expect(store.getMigrationReport().failed.map((f) => f.file)).toContain(legacyDb);
    });
});
