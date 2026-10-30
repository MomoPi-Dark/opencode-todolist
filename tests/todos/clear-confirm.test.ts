import { describe, expect, test } from "bun:test";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { handleClear } from "../../src/todos/handlers/clear";

const open: TodoRootItem[] = [
    { id: 1, content: "Still going", status: "in_progress" },
    { id: 2, content: "Not started", status: "pending" },
];

const clear = (
    todos: TodoRootItem[],
    input: { guard: "stand" | "disable"; ui?: { confirm: boolean } },
    sessionID = "ses_1",
) => handleClear(todos, { sessionID, ...input });

describe("clear dialog contract — ui.confirm", () => {
    test("a dismissed dialog cancels without changing the list", () => {
        const result = clear(open, { guard: "disable", ui: { confirm: false } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe("clear_cancelled");
            // The list is handed back untouched so the panel keeps rendering it.
            expect(result.todos).toEqual(open);
        }
    });

    test("cancelling wins even when the guard is on", () => {
        const result = clear(open, { guard: "stand", ui: { confirm: false } });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("clear_cancelled");
    });

    test("cancelling an already-empty list still reports the cancel", () => {
        const result = clear([], { guard: "stand", ui: { confirm: false } });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("clear_cancelled");
    });

    test("a confirmed dialog clears an open list through the guard", () => {
        // The user said yes in the dialog, which outranks the open-list guard.
        const result = clear(open, { guard: "stand", ui: { confirm: true } });

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.todos).toEqual([]);
    });

    test("a confirmed dialog still clears when the guard is disabled", () => {
        const result = clear(open, { guard: "disable", ui: { confirm: true } });

        expect(result.ok).toBe(true);
    });

    test("without a dialog the guard still refuses an open list", () => {
        // The agent tool path: no dialog, so only `guard` decides.
        const result = clear(open, { guard: "stand" });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("list_open");
    });

    test("without a dialog guard=disable clears, as before", () => {
        expect(clear(open, { guard: "disable" }).ok).toBe(true);
    });
});
