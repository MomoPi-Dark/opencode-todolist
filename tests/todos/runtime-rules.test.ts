import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import {
    readTodos,
    resetTodoStoreForTests,
    writeTodos,
} from "../../src/storage/todo-store";
import { handleUpdate } from "../../src/todos/handlers/update";

const dirs: string[] = [];

afterEach(() => {
    resetTodoStoreForTests();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    delete process.env.OPENCODE_TODOS_DIR;
});

describe("runtime update rules", () => {
    test("rejects moving an in-progress item back to pending", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-runtime-rules-"));
        dirs.push(dir);
        process.env.OPENCODE_TODOS_DIR = dir;

        const current: TodoRootItem[] = [
            { id: 1, content: "Task 1", status: "in_progress" },
        ];
        await writeTodos("session-a", current);

        const result = await handleUpdate("session-a", {
            operation: "update",
            updates: [{ id: 1, status: "pending" }],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("backward_transition");
        expect(await readTodos("session-a")).toEqual(current);
    });
});
