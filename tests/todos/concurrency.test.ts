import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { handleUpdate } from "../../src/todos/handlers/update";
import { getRevision, readTodosSync, resetTodoStoreForTests, writeTodos } from "../../src/storage/todo-store";

const dirs: string[] = [];
const plan: TodoRootItem[] = [{
    id: 1,
    content: "Root",
    status: "in_progress",
    children: [
        { id: 1.1, content: "first", status: "in_progress" },
        { id: 1.2, content: "second", status: "pending" },
    ],
}, { id: 2, content: "Other", status: "pending" }];

const setup = async () => {
    const dir = mkdtempSync(join(tmpdir(), "todo-concurrency-"));
    dirs.push(dir);
    process.env.OPENCODE_TODOS_DIR = dir;
    resetTodoStoreForTests();
    await writeTodos("session-a", plan);
    return "session-a";
};

afterEach(() => {
    resetTodoStoreForTests();
    delete process.env.OPENCODE_TODOS_DIR;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("current transaction behavior", () => {
    test("sequential updates preserve both changes", async () => {
        const session = await setup();
        expect((await handleUpdate(session, { operation: "update", updates: [{ id: 1.1, status: "completed" }] })).ok).toBe(true);
        expect((await handleUpdate(session, { operation: "update", updates: [{ id: 1.2, status: "completed" }] })).ok).toBe(true);
        const stored = readTodosSync(session)[0]!;
        expect(stored.children?.map((child) => child.status)).toEqual(["completed", "completed"]);
        expect(stored.status).toBe("completed");
        expect(getRevision(session)).toBe(3);
    });

    test("a failed batch leaves the stored list and revision unchanged", async () => {
        const session = await setup();
        const before = getRevision(session);
        const result = await handleUpdate(session, { operation: "update", updates: [
            { id: 1.1, status: "completed" },
            { id: 2, status: "in_progress" },
        ] });
        expect(result.ok).toBe(false);
        expect(getRevision(session)).toBe(before);
        expect(readTodosSync(session)).toEqual(plan);
    });
});
