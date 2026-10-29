import { describe, expect, test } from "bun:test";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { handleClear } from "../../src/todos/handlers/clear";

const open: TodoRootItem[] = [
    { id: 1, content: "Still going", status: "in_progress" },
    { id: 2, content: "Not started", status: "pending" },
];

describe("handleClear", () => {
    test("refuses while anything is open, by default", () => {
        const result = handleClear(open);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("list_open");
    });

    test("force clears an open list: the user already confirmed", () => {
        const result = handleClear(open, { force: true });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.todos).toEqual([]);
            expect(result.content).toContain("Cleared");
        }
    });

    test("force still reports the removed counts", () => {
        const withChild: TodoRootItem[] = [
            {
                id: 1,
                content: "Parent",
                status: "pending",
                children: [{ id: 1.1, content: "Child", status: "pending" }],
            },
        ];

        const result = handleClear(withChild, { force: true });

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.content).toContain("subtask");
    });

    test("clearing an empty list succeeds either way", () => {
        expect(handleClear([], {}).ok).toBe(true);
        expect(handleClear([], { force: true }).ok).toBe(true);
    });

    test("a finished list clears without force", () => {
        const done: TodoRootItem[] = [
            { id: 1, content: "Done", status: "completed" },
        ];

        expect(handleClear(done).ok).toBe(true);
    });
});
