import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { handleClear, handleCreate, handleRead, handleUpdate } from "../../src/todos/handlers";
import { getRevision, readTodosSync, resetTodoStoreForTests, updateTodos } from "../../src/storage/todo-store";

const dirs: string[] = [];
const root = (id: number, status: TodoRootItem["status"] = "pending"): TodoRootItem => ({
    id,
    content: `Task ${id}`,
    status,
});

const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "todo-session-"));
    dirs.push(dir);
    process.env.OPENCODE_TODOS_DIR = dir;
    resetTodoStoreForTests();
    return "session-a";
};

afterEach(() => {
    resetTodoStoreForTests();
    delete process.env.OPENCODE_TODOS_DIR;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("current storage and handlers seam", () => {
    test("create result persists through the storage transaction", async () => {
        const session = setup();
        const result = handleCreate([], { operation: "create", todos: [root(1, "in_progress")] });
        expect(result.ok).toBe(true);
        if (result.ok) await updateTodos(session, () => result.todos);
        expect(readTodosSync(session)).toEqual([root(1, "in_progress")]);
        expect(getRevision(session)).toBe(1);
    });

    test("update persists a status change and read does not write", async () => {
        const session = setup();
        await updateTodos(session, () => [root(1, "in_progress")]);
        const before = getRevision(session);
        const updated = await handleUpdate(session, { operation: "update", updates: [{ id: 1, status: "completed" }] });
        expect(updated.ok).toBe(true);
        expect(readTodosSync(session)[0]?.status).toBe("completed");
        expect(getRevision(session)).toBe(before + 1);
        const read = handleRead(readTodosSync(session), { operation: "read", format: "tree", scope: "all" });
        expect(read.ok).toBe(true);
        expect(getRevision(session)).toBe(before + 1);
    });

    test("clear persists an empty list only after a finished list", async () => {
        const session = setup();
        await updateTodos(session, () => [root(1, "completed")]);
        const cleared = handleClear(readTodosSync(session), { guard: "guard", sessionID: session });
        expect(cleared.ok).toBe(true);
        if (cleared.ok) await updateTodos(session, () => cleared.todos);
        expect(readTodosSync(session)).toEqual([]);
    });
});
