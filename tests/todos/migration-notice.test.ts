import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTodoStore, formatMigrationWarning } from "../../src/storage/todo-store";

const tmp = () => mkdtempSync(join(tmpdir(), "todo-notice-"));

/**
 * `OPENCODE_TODOS_DIR` pins the database directory so the store never scans the
 * legacy folders while a fixture is being prepared.
 */
const isolatedEnv = (home: string) => ({
    home,
    env: { OPENCODE_TODOS_DIR: join(home, "db") },
});

const legacyFile = (home: string, session: string, json: string) => {
    const dir = join(home, ".opencode", "sessions", session, "todos");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "todos-1700000000000.json"), json);
};

/** Unparseable JSON: `importSession` throws, the scanner records `failed`. */
const writeBrokenLegacy = (home: string, session = "session-a") =>
    legacyFile(home, session, "not json at all");

describe("migration notice", () => {
    test("a failed import produces a warning naming the file", async () => {
        const home = tmp();
        writeBrokenLegacy(home);

        const store = createTodoStore({ home, env: {} });
        await store.readTodos("session-a");

        const warning = store.getMigrationWarning();
        expect(warning).toBeDefined();
        expect(warning).toContain("could not be imported");
        expect(warning).toContain("todos-1700000000000.json");
    });

    test("a clean upgrade yields no warning", async () => {
        const home = tmp();
        const store = createTodoStore({ home, env: {} });
        await store.readTodos("session-a");

        expect(store.getMigrationWarning()).toBeUndefined();
        expect(store.takeMigrationNotice()).toBeUndefined();
    });

    test("the notice is handed out once, then stays silent", async () => {
        const home = tmp();
        writeBrokenLegacy(home);

        const store = createTodoStore({ home, env: {} });
        await store.readTodos("session-a");

        const first = store.takeMigrationNotice();
        expect(first).toBeDefined();
        expect(store.takeMigrationNotice()).toBeUndefined();

        // The non-consuming read keeps working so callers can inspect it.
        expect(store.getMigrationWarning()).toBe(first);
    });

    test("a skipped import produces its own message", () => {
        // `skipped` only reaches the report when a legacy file survives for a
        // session that already holds rows, which the scanner makes unlikely end
        // to end. The message branch is pure, so assert it directly.
        const warning = formatMigrationWarning(
            { imported: [], skipped: ["/legacy/todos-1.json"], failed: [] },
            "/legacy",
            "/db/todos.db",
        );

        expect(warning).toBeDefined();
        expect(warning).toContain("left");
        expect(warning).toContain("not imported");
        expect(warning).toContain("todos-1.json");
    });

    test("failed outranks skipped in the rendered message", () => {
        const warning = formatMigrationWarning(
            {
                imported: [],
                skipped: ["/legacy/skipped.json"],
                failed: [{ file: "/legacy/broken.json", error: "boom" }],
            },
            "/legacy",
            "/db/todos.db",
        );

        expect(warning).toContain("could not be imported");
        expect(warning).toContain("broken.json");
        expect(warning).not.toContain("left");
    });

    test("a clean report renders nothing", () => {
        expect(
            formatMigrationWarning(
                { imported: ["/legacy/ok.json"], skipped: [], failed: [] },
                "/legacy",
                "/db/todos.db",
            ),
        ).toBeUndefined();
    });

    test("a broken import outranks a skipped one", async () => {
        const home = tmp();
        writeBrokenLegacy(home);

        const store = createTodoStore({ home, env: {} });
        await store.readTodos("session-a");

        expect(store.getMigrationWarning()).toContain("could not be imported");
    });

    test("reset clears the one-shot flag", async () => {
        const home = tmp();
        writeBrokenLegacy(home);

        const store = createTodoStore({ home, env: {} });
        await store.readTodos("session-a");
        expect(store.takeMigrationNotice()).toBeDefined();

        store.resetForTests();
        expect(store.takeMigrationNotice()).toBeDefined();
    });
});
