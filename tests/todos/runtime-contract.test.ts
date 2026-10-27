import { describe, expect, test } from "bun:test";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { handleCreate } from "../../src/todos/handlers/create";

describe("runtime handler contract", () => {
    test("create formats the new list instead of the previous empty list", () => {
        const result = handleCreate([], {
            operation: "create",
            todos: [{ id: 1, content: "Task 1", status: "in_progress" }],
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.content).toContain("Task 1");
            expect(result.content).not.toContain("All done.");
        }
    });

});
