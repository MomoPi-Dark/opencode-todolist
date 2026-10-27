import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { resetDatabaseForTests, copyLegacyDatabase, openDatabase } from "../../src/storage/db";
import { TodoStore } from "../../src/storage/todo-store";

/**
 * The database used to live at `<home>/.opencode/sessions/todos.db`. It now
 * lives under `<home>/.local/share/opencode/todolist/`.
 *
 * Upgrading must not look like "all my todos vanished", and it must never
 * destroy the old file: the copy is made first (`VACUUM INTO`, which is
 * transaction-safe and leaves the source untouched), and only then is the
 * source renamed to `todos.db.migrated`.
 */

const dirs: string[] = [];
const root = (id: number, extra: Partial<TodoRootItem> = {}): TodoRootItem => ({
    id,
    content: `Task ${id}`,
    status: "pending",
    ...extra,
});

const tmp = (prefix: string): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
};

/** A store resolving through `<home>`, i.e. the real upgrade path. */
const storeAtHome = (home: string): TodoStore => new TodoStore({ env: {}, home });

/** A store pinned to an explicit directory, used only to seed fixtures. */
const storeAt = (dataDir: string, home: string): TodoStore =>
    new TodoStore({ env: { OPENCODE_TODOS_DIR: dataDir }, home });

afterEach(() => {
    resetDatabaseForTests();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("legacy database migration", () => {
    test("copies the old database forward and keeps the old file", async () => {
        const home = tmp("todo-home-");
        const legacyDir = join(home, ".opencode", "sessions");
        const newDir = join(home, ".local", "share", "opencode", "todolist");

        const before = storeAt(legacyDir, home);
        await before.writeTodos("session-a", [root(1, { status: "completed" })]);
        resetDatabaseForTests();

        const after = storeAtHome(home);
        expect(await after.readTodos("session-a")).toEqual([
            root(1, { status: "completed" }),
        ]);

        expect(existsSync(join(newDir, "todos.db"))).toBe(true);
        expect(existsSync(join(legacyDir, "todos.db"))).toBe(false);
        expect(existsSync(join(legacyDir, "todos.db.migrated"))).toBe(true);
    });

    test("copies rows that are still only in the WAL", async () => {
        const home = tmp("todo-home-");
        const legacyDir = join(home, ".opencode", "sessions");
        mkdirSync(legacyDir, { recursive: true });
        const legacyDb = join(legacyDir, "todos.db");
        const target = join(home, ".local", "share", "opencode", "todolist", "todos.db");

        // A writer that stays open holds its rows in `todos.db-wal`, which is
        // exactly the state of a database left behind by a killed process.
        const writer = openDatabase(legacyDb);
        try {
            writer.sqlite.run(
                "INSERT INTO todo_session (session_key, created_at, updated_at) VALUES ('s', 'now', 'now')",
            );
            writer.sqlite.run(
                "INSERT INTO todo_item (session_key, id, parent_id, content, status, position) VALUES ('s', '1', NULL, 'Task 7', 'completed', 0)",
            );

            expect(copyLegacyDatabase(legacyDb, target)).toBe(true);
        } finally {
            writer.sqlite.close();
        }

        const copied = openDatabase(target);
        try {
            expect(
                copied.sqlite.query("SELECT content FROM todo_item").all(),
            ).toEqual([{ content: "Task 7" }]);
        } finally {
            copied.sqlite.close();
        }
    });

    test("does nothing when a new database already exists", async () => {
        const home = tmp("todo-home-");
        const legacyDir = join(home, ".opencode", "sessions");
        const newDir = join(home, ".local", "share", "opencode", "todolist");

        // New database first, so the legacy file appears *after* it exists.
        const current = storeAt(newDir, home);
        await current.writeTodos("session-a", [root(2)]);
        resetDatabaseForTests();

        const legacy = storeAt(legacyDir, home);
        await legacy.writeTodos("session-a", [root(1)]);
        resetDatabaseForTests();

        // Second open after both files exist must keep the new data.
        const reopened = storeAtHome(home);
        expect(await reopened.readTodos("session-a")).toEqual([root(2)]);
        expect(existsSync(join(legacyDir, "todos.db"))).toBe(true);
    });

    test("is a no-op when there is no legacy database", async () => {        const home = tmp("todo-home-");
        mkdirSync(join(home, ".local", "share", "opencode", "todolist"), {
            recursive: true,
        });
        const store = storeAtHome(home);
        expect(await store.readTodos("session-a")).toEqual([]);
    });

    test("still imports legacy JSON from the OLD base directory", async () => {
        const home = tmp("todo-home-");
        const sessionDir = join(
            home,
            ".opencode",
            "sessions",
            "session-a",
            "todos",
        );
        mkdirSync(sessionDir, { recursive: true });
        const file = join(sessionDir, "todos-1700000000000.json");
        writeFileSync(
            file,
            JSON.stringify({ todos: [root(1, { status: "completed" })] }),
        );

        const store = storeAtHome(home);
        expect(await store.readTodos("session-a")).toEqual([
            root(1, { status: "completed" }),
        ]);
        // Consumed source is renamed, never deleted.
        expect(existsSync(`${file}.migrated`)).toBe(true);
    });
});
