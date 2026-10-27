import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TodoChildren, TodoRootItem } from "../../src/schemas/todo/item";
import { openDatabase, type TodoDatabaseHandle } from "../../src/storage/db";
import {
    getRevision,
    readTodoData,
    readTodosSync,
    resetTodoStoreForTests,
    updateTodos,
    writeTodos,
} from "../../src/storage/todo-store";

const dirs: string[] = [];
const handles: TodoDatabaseHandle[] = [];

const child = (id: number, extra: Partial<TodoChildren> = {}): TodoChildren => ({
    id,
    content: `Sub ${id}`,
    status: "pending",
    ...extra,
});

const root = (id: number, extra: Partial<TodoRootItem> = {}): TodoRootItem => ({
    id,
    content: `Task ${id}`,
    status: "pending",
    ...extra,
});

const shape: TodoRootItem[] = [
    root(1, {
        status: "in_progress",
        children: [child(1.1, { status: "in_progress" }), child(1.2)],
    }),
    root(2),
];

const fresh = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "todo-storage-"));
    dirs.push(dir);
    process.env.OPENCODE_TODOS_DIR = dir;
    resetTodoStoreForTests();
    return "session-a";
};

afterEach(() => {
    resetTodoStoreForTests();
    delete process.env.OPENCODE_TODOS_DIR;
    for (const handle of handles.splice(0)) handle.sqlite.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SQLite todo storage", () => {
    test("reads an empty unknown session", () => {
        const session = fresh();
        expect(readTodosSync(session)).toEqual([]);
        expect(readTodoData(session)).toBeNull();
    });

    test("round-trips roots, children, notes, and dotted ids", async () => {
        const session = fresh();
        await writeTodos(session, shape);
        expect(readTodosSync(session)).toEqual(shape);
        expect(readTodosSync(session)[0]?.children?.map((item) => item.id)).toEqual([1.1, 1.2]);
    });

    test("replaces rows and keeps a revision for an empty list", async () => {
        const session = fresh();
        await writeTodos(session, [root(1)]);
        await writeTodos(session, []);
        expect(readTodosSync(session)).toEqual([]);
        expect(readTodoData(session)?.todos).toEqual([]);
        expect(getRevision(session)).toBe(2);
    });

    test("isolates sessions", async () => {
        const session = fresh();
        await writeTodos(session, [root(1)]);
        await writeTodos("session-b", [root(2)]);
        expect(readTodosSync(session).map((item) => item.id)).toEqual([1]);
        expect(readTodosSync("session-b").map((item) => item.id)).toEqual([2]);
    });

    test("updates atomically and auto-completes finished children", async () => {
        const session = fresh();
        await writeTodos(session, [
            root(1, {
                status: "in_progress",
                children: [child(1.1, { status: "in_progress" }), child(1.2)],
            }),
        ]);
        await updateTodos(session, (todos) => [
            { ...todos[0]!, children: [
                { ...todos[0]!.children![0]!, status: "completed" },
                { ...todos[0]!.children![1]!, status: "completed" },
            ] },
        ]);
        expect(readTodosSync(session)[0]?.status).toBe("completed");
    });

    test("rejects invalid writes without replacing existing rows", async () => {
        const session = fresh();
        await writeTodos(session, [root(1)]);
        await expect(writeTodos(session, [root(1), root(2, { status: "completed" })])).rejects.toThrow();
        expect(readTodosSync(session).map((item) => item.id)).toEqual([1]);
    });

    test("enforces the composite parent foreign key", () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-storage-fk-"));
        dirs.push(dir);
        const handle = openDatabase(join(dir, "todos.db"));
        handles.push(handle);
        handle.sqlite.run("INSERT INTO todo_session (session_key, created_at, updated_at) VALUES ('session-a', 'now', 'now')");
        expect(() => handle.sqlite.run(
            "INSERT INTO todo_item (session_key, id, parent_id, content, status, position) VALUES ('session-a', '1.1', 'missing', 'orphan', 'pending', 0)",
        )).toThrow();
    });
});
