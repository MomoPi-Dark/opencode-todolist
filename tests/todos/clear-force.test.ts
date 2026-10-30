import { describe, expect, test } from "bun:test";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { handleClear } from "../../src/todos/handlers/clear";

const open: TodoRootItem[] = [
    { id: 1, content: "Still going", status: "in_progress" },
    { id: 2, content: "Not started", status: "pending" },
];

const clear = (
    todos: TodoRootItem[],
    guard: "stand" | "disable",
    sessionID = "ses_1",
) => handleClear(todos, { guard, sessionID });

describe("handleClear", () => {
    test("guard refuses while anything is open", () => {
        const result = clear(open, "stand");

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("list_open");
    });

    test("disable clears an open list: the user already confirmed", () => {
        const result = clear(open, "disable");

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.todos).toEqual([]);
            expect(result.content).toContain("Cleared");
        }
    });

    test("disable still reports the removed counts", () => {
        const withChild: TodoRootItem[] = [
            {
                id: 1,
                content: "Parent",
                status: "pending",
                children: [{ id: 1.1, content: "Child", status: "pending" }],
            },
        ];

        const result = clear(withChild, "disable");

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.content).toContain("subtask");
    });

    test("clearing an empty list is refused, not reported as success", () => {
        for (const guard of ["stand", "disable"] as const) {
            const result = clear([], guard);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe("list_empty");
        }
    });

    test("a finished list clears with the guard on", () => {
        const done: TodoRootItem[] = [
            { id: 1, content: "Done", status: "completed" },
        ];

        expect(clear(done, "stand").ok).toBe(true);
    });
});
