import assert from "node:assert/strict";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TodoRootItem } from "../src/schemas/todo";

// Storage suite for the SQLite backend.
//
// Each block gets its own data directory so tests cannot see each other's
// rows: the store resolves its location from `OPENCODE_TODOS_DIR` at call
// time, and importing it once per data directory would cache a connection, so
// the directory is set before the first import and the store is only used
// through the module functions.

const DATA_DIR = "/tmp/todolist-sqlite-test";
process.env.OPENCODE_TODOS_DIR = DATA_DIR;

const {
    getDatabasePath,
    readTodoData,
    readTodosSync,
    getRevision,
    takeHintRevision,
    updateTodos,
    writeTodos,
    resetTodoStoreForTests,
} = await import("../src/storage/todo-store.ts");
const { consumeTodoHint } = await import("../src/todos/hint.ts");
const { importLegacyJson } = await import("../src/storage/migrate-json.ts");
const { getDatabase } = await import("../src/storage/db.ts");
const { todoItem } = await import("../src/storage/schema.ts");

/**
 * Points the store at a clean directory.
 *
 * The store caches one SQLite connection per process, so deleting the
 * directory alone is not enough: the cached handle would keep reading the old,
 * now-unlinked file. Resetting first forces the next call to reopen.
 */
function freshStore() {
    resetTodoStoreForTests();
    rmSync(DATA_DIR, { recursive: true, force: true });
    process.env.OPENCODE_TODOS_DIR = DATA_DIR;
}

freshStore();

const SID = "ses_storage_test";

// ---------------------------------------------------------------------------
// Round-trip: hierarchy, notes, priority, and ordering survive a write
// ---------------------------------------------------------------------------

{
    freshStore();
    const sample: TodoRootItem[] = [
        {
            id: 1,
            content: "Root A",
            status: "in_progress",
            priority: "high",
            note: "critical path",
            children: [
                { id: 1.1, content: "Child A1", status: "completed" },
                {
                    id: 1.2,
                    content: "Child A2",
                    status: "pending",
                    note: "child note",
                },
            ],
        },
        { id: 2, content: "Root B", status: "pending" },
    ];

    await writeTodos(SID, sample);
    const read = readTodosSync(SID);

    assert.equal(read.length, 2, "both roots must come back");
    assert.equal(read[0]?.id, 1, "root order must be preserved");
    assert.equal(read[1]?.id, 2, "root order must be preserved");
    assert.equal(read[0]?.note, "critical path", "root note must persist");
    assert.equal(read[0]?.priority, "high", "root priority must persist");
    assert.equal(read[0]?.children?.length, 2, "children must come back");
    assert.equal(read[0]?.children?.[0]?.id, 1.1, "child order must hold");
    assert.equal(
        read[0]?.children?.[1]?.note,
        "child note",
        "child note must persist",
    );

    console.log("✔ storage: round-trips hierarchy, notes, priority and order");
}

// ---------------------------------------------------------------------------
// Absent optional fields stay absent rather than becoming null
// ---------------------------------------------------------------------------

{
    freshStore();
    await writeTodos(SID, [{ id: 1, content: "Bare", status: "pending" }]);
    const read = readTodosSync(SID)[0]!;

    assert.ok(!("note" in read), "a missing note must not become a null field");
    assert.ok(
        !("priority" in read),
        "a missing priority must not become a null field",
    );

    console.log("✔ storage: absent optional fields stay absent");
}

// ---------------------------------------------------------------------------
// Revision increases per write and is readable
// ---------------------------------------------------------------------------

{
    freshStore();
    const before = getRevision(SID);
    await writeTodos(SID, [{ id: 1, content: "One", status: "pending" }]);
    const afterFirst = getRevision(SID);
    await writeTodos(SID, [{ id: 1, content: "Two", status: "pending" }]);
    const afterSecond = getRevision(SID);

    assert.equal(before, 0, "an untouched session has no revision");
    assert.equal(afterFirst, 1, "first write is revision 1");
    assert.equal(afterSecond, 2, "second write is revision 2");

    const data = readTodoData(SID);
    assert.equal(data?.version, afterSecond, "version mirrors the revision");
    assert.ok(data?.created_at, "created_at must be set");
    assert.ok(data?.updated_at, "updated_at must be set");

    console.log("✔ storage: revision advances on every write");
}

// ---------------------------------------------------------------------------
// readTodoData returns null for an unknown session
// ---------------------------------------------------------------------------

{
    freshStore();
    assert.equal(
        readTodoData("ses_never_written"),
        null,
        "an unknown session has no record",
    );
    console.log("✔ storage: unknown session reads as null");
}

// ---------------------------------------------------------------------------
// updateTodos reads, transforms and writes in one transaction
// ---------------------------------------------------------------------------

{
    freshStore();
    await writeTodos(SID, [
        {
            id: 1,
            content: "Root",
            status: "in_progress",
            children: [
                { id: 1.1, content: "C1", status: "completed" },
                { id: 1.2, content: "C2", status: "pending" },
            ],
        },
    ]);

    const next = await updateTodos(SID, (current) => {
        current[0]!.children![1]!.status = "in_progress";
        return current;
    });

    assert.equal(
        next[0]?.children?.[1]?.status,
        "in_progress",
        "the transform result is returned",
    );
    assert.equal(
        readTodosSync(SID)[0]?.children?.[1]?.status,
        "in_progress",
        "the transform result is persisted",
    );

    console.log("✔ storage: updateTodos persists the transformed list");
}

// ---------------------------------------------------------------------------
// An invalid list rolls back and does not bump the revision
// ---------------------------------------------------------------------------

{
    freshStore();
    await writeTodos(SID, [
        { id: 1, content: "Ok", status: "in_progress" },
        { id: 2, content: "Later", status: "pending" },
    ]);
    const revisionBefore = getRevision(SID);

    await assert.rejects(
        () =>
            updateTodos(SID, () => [
                { id: 1, content: "A", status: "in_progress" },
                { id: 2, content: "B", status: "in_progress" },
            ]),
        /Only 1 top-level task/,
        "two in_progress roots must be rejected",
    );

    assert.equal(
        getRevision(SID),
        revisionBefore,
        "a rejected write must not bump the revision",
    );
    assert.equal(
        readTodosSync(SID).length,
        2,
        "a rejected write must leave the stored list untouched",
    );

    console.log("✔ storage: invalid write rolls back without bumping revision");
}

// ---------------------------------------------------------------------------
// Foreign key: a subtask cannot point at a missing parent
// ---------------------------------------------------------------------------

{
    freshStore();
    const handle = getDatabase(getDatabasePath());
    handle.sqlite.exec("PRAGMA foreign_keys = ON");
    handle.sqlite.exec(
        "INSERT INTO todo_session (session_key, revision, hint_revision, created_at, updated_at) VALUES ('s_fk', 0, 0, 't', 't')",
    );

    assert.throws(
        () =>
            handle.sqlite.exec(
                "INSERT INTO todo_item (session_key, id, parent_id, content, status, position) VALUES ('s_fk', '1.9', 'ghost', 'orphan', 'pending', 0)",
            ),
        /FOREIGN KEY constraint failed/,
        "an orphan child must be rejected by the database",
    );

    console.log("✔ storage: foreign key rejects an orphan subtask");
}

// ---------------------------------------------------------------------------
// Deleting a session cascades to its items
// ---------------------------------------------------------------------------

{
    freshStore();
    await writeTodos(SID, [
        {
            id: 1,
            content: "Root",
            status: "pending",
            children: [{ id: 1.1, content: "Child", status: "pending" }],
        },
    ]);

    const handle = getDatabase(getDatabasePath());
    const key = readTodosSync(SID).length > 0 ? undefined : undefined;
    void key;

    // Use the exported helper's effect: clearing the list removes rows, and the
    // session row is dropped through the cascade when the session is deleted.
    handle.sqlite.exec("PRAGMA foreign_keys = ON");
    const before = handle.sqlite
        .query("SELECT COUNT(*) AS n FROM todo_item")
        .get() as { n: number };
    assert.equal(before.n, 2, "one root and one child must be stored");

    handle.sqlite.exec("DELETE FROM todo_session");
    const after = handle.sqlite
        .query("SELECT COUNT(*) AS n FROM todo_item")
        .get() as { n: number };
    assert.equal(after.n, 0, "deleting the session must cascade to items");

    console.log("✔ storage: deleting a session cascades to its items");
}

// ---------------------------------------------------------------------------
// Clearing removes the items but keeps the session row and bumps the revision
// ---------------------------------------------------------------------------

{
    freshStore();
    await writeTodos(SID, [
        {
            id: 1,
            content: "Something",
            status: "in_progress",
            children: [{ id: 1.1, content: "Child", status: "pending" }],
        },
    ]);

    const handle = getDatabase(getDatabasePath());
    handle.sqlite.exec("PRAGMA foreign_keys = ON");
    const rowsBefore = handle.sqlite
        .query("SELECT COUNT(*) AS n FROM todo_item")
        .get() as { n: number };
    assert.equal(rowsBefore.n, 2, "the items must be stored first");

    await writeTodos(SID, []);

    assert.deepEqual(readTodosSync(SID), [], "the list must be empty");
    const rowsAfter = handle.sqlite
        .query("SELECT COUNT(*) AS n FROM todo_item")
        .get() as { n: number };
    assert.equal(rowsAfter.n, 0, "every item must be removed");

    // The session row survives: it owns the revision and hint counters.
    const sessions = handle.sqlite
        .query("SELECT session_key, revision FROM todo_session")
        .all() as Array<{ session_key: string; revision: number }>;
    assert.equal(sessions.length, 1, "the session row must be kept");
    assert.equal(
        sessions[0]!.revision,
        2,
        "clearing is still a write and bumps the revision",
    );
    assert.equal(
        readTodoData(SID)?.version,
        2,
        "readTodoData still reports the session",
    );
    assert.equal(readTodoData(SID)?.todos.length, 0, "no items remain");

    // A later write continues on the same row.
    await writeTodos(SID, [{ id: 1, content: "Again", status: "pending" }]);
    assert.equal(readTodosSync(SID)[0]?.content, "Again", "the list is usable");
    assert.equal(
        readTodoData(SID)?.version,
        3,
        "the revision keeps counting on the same row",
    );

    console.log("✔ storage: clearing keeps the session and bumps the revision");
}

// ---------------------------------------------------------------------------
// Hint fires once per revision, never for a finished list, never when stale
// ---------------------------------------------------------------------------

{
    freshStore();
    assert.equal(
        consumeTodoHint(SID),
        undefined,
        "no data means no hint",
    );

    await writeTodos(SID, [{ id: 1, content: "Open", status: "in_progress" }]);
    assert.ok(consumeTodoHint(SID), "an open item produces the hint once");
    assert.equal(
        consumeTodoHint(SID),
        undefined,
        "the same revision must not hint twice",
    );

    await writeTodos(SID, [{ id: 1, content: "Open again", status: "pending" }]);
    assert.ok(consumeTodoHint(SID), "a new revision hints again");
    const revision = getRevision(SID);
    assert.equal(
        takeHintRevision(SID, revision),
        revision,
        "recording the same revision is a no-op",
    );

    await writeTodos(SID, [{ id: 1, content: "Done", status: "completed" }]);
    assert.equal(
        consumeTodoHint(SID),
        undefined,
        "a finished list produces no hint",
    );

    await writeTodos(SID, [{ id: 1, content: "Stale", status: "in_progress" }]);
    assert.equal(
        consumeTodoHint(SID, { now: Date.now() + 2 * 60 * 60 * 1000 }),
        undefined,
        "a stale list produces no hint",
    );

    console.log("✔ storage: hint fires once per revision and respects staleness");
}

// ---------------------------------------------------------------------------
// Importing legacy JSON: hierarchy lands, source is preserved, second run skips
// ---------------------------------------------------------------------------

{
    freshStore();
    const legacyDir = join(DATA_DIR, "s_legacy123");
    mkdirSync(join(legacyDir, "todos"), { recursive: true });
    const legacyFile = join(legacyDir, "todos", "todos-1000.json");
    writeFileSync(
        legacyFile,
        JSON.stringify({
            version: 3,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-02T00:00:00.000Z",
            todos: [
                {
                    id: 1,
                    content: "Imported root",
                    status: "in_progress",
                    children: [
                        { id: 1.1, content: "Imported child", status: "pending" },
                    ],
                },
            ],
        }),
    );

    const handle = getDatabase(getDatabasePath());
    const first = importLegacyJson(handle, DATA_DIR);
    assert.equal(first.imported.length, 1, "the legacy file must be imported");
    assert.equal(first.failed.length, 0, "import must not fail");

    const rows = handle.sqlite
        .query(
            "SELECT id, parent_id, position FROM todo_item WHERE session_key = 's_legacy123' ORDER BY position",
        )
        .all() as Array<{ id: string; parent_id: string | null; position: number }>;
    assert.deepEqual(
        rows.map((row) => [row.id, row.parent_id, row.position]),
        [
            ["1", null, 0],
            ["1.1", "1", 1],
        ],
        "imported rows must keep id, parent and order",
    );

    const contents = readdirSync(join(legacyDir, "todos"));
    assert.ok(
        !contents.includes("todos-1000.json"),
        "the source file must be renamed, not left in place",
    );
    assert.ok(
        contents.includes("todos-1000.json.migrated"),
        "the source file must be preserved as .migrated",
    );

    const second = importLegacyJson(handle, DATA_DIR);
    assert.equal(second.imported.length, 0, "a second import must find nothing");
    assert.equal(
        handle.sqlite.query("SELECT COUNT(*) AS n FROM todo_item").get() &&
            (handle.sqlite.query("SELECT COUNT(*) AS n FROM todo_item").get() as { n: number }).n,
        2,
        "a second import must not duplicate rows",
    );

    console.log("✔ storage: legacy JSON imports once and preserves the source");
}

// ---------------------------------------------------------------------------
// Importing must never overwrite a session that already has rows
// ---------------------------------------------------------------------------

{
    freshStore();
    const legacyDir = join(DATA_DIR, "s_conflict");
    mkdirSync(join(legacyDir, "todos"), { recursive: true });
    writeFileSync(
        join(legacyDir, "todos", "todos-1.json"),
        JSON.stringify({
            todos: [{ id: 9, content: "From legacy JSON", status: "pending" }],
        }),
    );

    // A session already present in SQLite wins over the stale file.
    const handle = getDatabase(getDatabasePath());
    const { replaceSessionTodos } = await import(
        "../src/storage/migrate-json.ts"
    );
    replaceSessionTodos(handle, "s_conflict", [
        { id: 1, content: "From database", status: "in_progress" },
    ]);

    const result = importLegacyJson(handle, DATA_DIR);
    assert.equal(result.imported.length, 0, "no import when rows exist");
    assert.equal(result.skipped.length, 1, "the file must be reported skipped");

    const stored = handle.sqlite
        .query("SELECT content FROM todo_item WHERE session_key = 's_conflict'")
        .all() as Array<{ content: string }>;
    assert.deepEqual(
        stored.map((row) => row.content),
        ["From database"],
        "existing rows must not be replaced",
    );
    assert.ok(
        readdirSync(join(legacyDir, "todos")).includes("todos-1.json"),
        "a skipped source file must stay untouched",
    );

    console.log("✔ storage: import never overwrites an existing session");
}

// ---------------------------------------------------------------------------
// Two connections see each other's commits through `data_version`
// ---------------------------------------------------------------------------

{
    freshStore();
    await writeTodos(SID, [{ id: 1, content: "Seed", status: "pending" }]);

    // A second connection plays the role of the other OpenCode process.
    const { Database } = await import("bun:sqlite");
    const writer = new Database(getDatabasePath());
    writer.exec("PRAGMA journal_mode = WAL");
    writer.exec("PRAGMA busy_timeout = 5000");

    const reader = getDatabase(getDatabasePath()).sqlite;
    const before = (
        reader.query("PRAGMA data_version").get() as { data_version: number }
    ).data_version;

    writer.exec(
        "INSERT INTO todo_item (session_key, id, parent_id, content, status, position) VALUES ('s_other', '1', NULL, 'from another connection', 'pending', 0)",
    );

    const after = (
        reader.query("PRAGMA data_version").get() as { data_version: number }
    ).data_version;

    assert.notEqual(
        before,
        after,
        "a commit from another connection must move data_version",
    );

    // This connection's own write must NOT move its own counter.
    const ownBefore = (
        reader.query("PRAGMA data_version").get() as { data_version: number }
    ).data_version;
    await writeTodos(SID, [{ id: 1, content: "Own write", status: "pending" }]);
    const ownAfter = (
        reader.query("PRAGMA data_version").get() as { data_version: number }
    ).data_version;
    assert.equal(
        ownBefore,
        ownAfter,
        "this connection's own commit must not change its data_version",
    );

    writer.close();
    console.log("✔ storage: data_version reports only other connections' commits");
}

// ---------------------------------------------------------------------------
// Concurrent writers do not lose updates
// ---------------------------------------------------------------------------

{
    freshStore();
    await writeTodos(SID, [{ id: 1, content: "init", status: "in_progress" }]);

    const worker = join(DATA_DIR, "worker.ts");
    // The worker must import the store by a path that exists wherever the suite
    // runs, so it is derived from this file's own location instead of a
    // machine-specific absolute path. `import.meta.dirname` is `test/`.
    const storeURL = new URL("../src/storage/todo-store.ts", import.meta.url).href;
    writeFileSync(
        worker,
        [
            `const S = await import(${JSON.stringify(storeURL)});`,
            "const tag = process.argv[2];",
            "for (let i = 0; i < 10; i++) {",
            "  await S.updateTodos(process.env.SID, (cur) => {",
            "    const root = cur[0];",
            "    if (!root) return [{ id: 1, content: `${tag}-0`, status: 'in_progress' }];",
            "    root.content = `${tag}-${i}`;",
            "    return cur;",
            "  });",
            "}",
        ].join("\n"),
    );

    const env = { ...process.env, OPENCODE_TODOS_DIR: DATA_DIR, SID };
    const processes = ["A", "B", "C"].map((tag) =>
        Bun.spawn(["bun", worker], { env, stdout: "pipe", stderr: "pipe" }),
    );
    const exits = await Promise.all(
        processes.map(async (process) => ({
            code: await process.exited,
            stderr: await new Response(process.stderr).text(),
        })),
    );
    // Without this, a worker that fails to start shows up only as a confusing
    // revision mismatch further down.
    for (const [i, result] of exits.entries()) {
        assert.equal(
            result.code,
            0,
            `worker ${["A", "B", "C"][i]} exited with ${result.code}: ${result.stderr}`,
        );
    }

    assert.equal(
        getRevision(SID),
        31,
        "1 seed + 30 concurrent updates must all land (no lost update)",
    );

    rmSync(worker, { force: true });
    console.log("✔ storage: three concurrent writers lose no updates");
}

rmSync(DATA_DIR, { recursive: true, force: true });
void todoItem;

console.log("\n✔ SQLite storage suite passed");
