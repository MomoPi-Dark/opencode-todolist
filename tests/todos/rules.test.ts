import { describe, expect, test } from "bun:test";
import type { TodoChildren, TodoRootItem } from "../../src/schemas/todo/item";
import type { TodoUpdateItem } from "../../src/schemas/todo/update";
import { TodoRules, type TodoRuleCode } from "../../src/todos/rules";

const child = (
    id: number,
    extra: Partial<TodoChildren> = {},
): TodoChildren => ({
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

const update = (
    extra: Partial<TodoUpdateItem> & { id: number },
): TodoUpdateItem => ({
    ...extra,
});

/** Asserts the update is refused with a given rule code. */
const refuses = (
    todos: TodoRootItem[],
    upd: TodoUpdateItem,
    code: TodoRuleCode,
): void => {
    const result = TodoRules.apply(todos, [upd]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
};

const accepts = (todos: TodoRootItem[], upd: TodoUpdateItem) => {
    const result = TodoRules.apply(todos, [upd]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    return result.todos;
};

describe("TodoRules.canTransition", () => {
    test("same status is always allowed", () => {
        for (const status of [
            "pending",
            "in_progress",
            "completed",
            "cancelled",
            "error",
        ] as const) {
            expect(TodoRules.canTransition(status, status)).toBe(true);
        }
    });

    test("pending may start, finish, drop or break", () => {
        for (const to of [
            "in_progress",
            "completed",
            "cancelled",
            "error",
        ] as const) {
            expect(TodoRules.canTransition("pending", to)).toBe(true);
        }
    });

    test("in_progress may finish, drop or break, never rewind", () => {
        expect(TodoRules.canTransition("in_progress", "completed")).toBe(true);
        expect(TodoRules.canTransition("in_progress", "cancelled")).toBe(true);
        expect(TodoRules.canTransition("in_progress", "error")).toBe(true);
        expect(TodoRules.canTransition("in_progress", "pending")).toBe(false);
    });

    test("error may be repaired, never rewound to pending", () => {
        expect(TodoRules.canTransition("error", "in_progress")).toBe(true);
        expect(TodoRules.canTransition("error", "completed")).toBe(true);
        expect(TodoRules.canTransition("error", "cancelled")).toBe(true);
        expect(TodoRules.canTransition("error", "pending")).toBe(false);
    });

    test("completed and cancelled are locked", () => {
        for (const to of [
            "pending",
            "in_progress",
            "completed",
            "cancelled",
            "error",
        ] as const) {
            if (to === "completed") continue;
            expect(TodoRules.canTransition("completed", to)).toBe(false);
        }
        for (const to of [
            "pending",
            "in_progress",
            "completed",
            "cancelled",
            "error",
        ] as const) {
            if (to === "cancelled") continue;
            expect(TodoRules.canTransition("cancelled", to)).toBe(false);
        }
    });

    test("isFinal covers exactly completed and cancelled", () => {
        expect(TodoRules.isFinal("completed")).toBe(true);
        expect(TodoRules.isFinal("cancelled")).toBe(true);
        expect(TodoRules.isFinal("pending")).toBe(false);
        expect(TodoRules.isFinal("in_progress")).toBe(false);
        expect(TodoRules.isFinal("error")).toBe(false);
    });
});

describe("TodoRules.apply — basic patches", () => {
    test("advances a root to in_progress", () => {
        const todos = accepts([root(1)], update({ id: 1, status: "in_progress" }));
        expect(todos[0]?.status).toBe("in_progress");
    });

    test("patches content, priority and note", () => {
        const todos = accepts(
            [root(1)],
            update({
                id: 1,
                content: "Renamed",
                priority: "high",
                note: "src/auth.ts",
            }),
        );
        expect(todos[0]).toMatchObject({
            content: "Renamed",
            priority: "high",
            note: "src/auth.ts",
        });
    });

    test("null removes priority and note", () => {
        const todos = accepts(
            [root(1, { priority: "high", note: "old" })],
            update({ id: 1, priority: null, note: null }),
        );
        expect(todos[0]?.priority).toBeUndefined();
        expect(todos[0]?.note).toBeUndefined();
    });

    test("omitted fields keep their value", () => {
        const todos = accepts(
            [root(1, { priority: "low", note: "keep" })],
            update({ id: 1, content: "New" }),
        );
        expect(todos[0]?.priority).toBe("low");
        expect(todos[0]?.note).toBe("keep");
    });

    test("patches a subtask without touching its siblings", () => {
        const todos = accepts(
            [
                root(1, {
                    status: "in_progress",
                    children: [child(1.1, { status: "in_progress" }), child(1.2)],
                }),
            ],
            update({ id: 1.2, note: "later" }),
        );
        expect(todos[0]?.children?.[1]?.note).toBe("later");
        expect(todos[0]?.children?.[0]?.note).toBeUndefined();
    });

    test("never mutates the list it was given", () => {
        const todos = [root(1)];
        accepts(todos, update({ id: 1, status: "in_progress" }));
        expect(todos[0]?.status).toBe("pending");
    });

    test("reports every changed row", () => {
        const result = TodoRules.apply(
            [root(1, { children: [child(1.1), child(1.2)] })],
            [
                update({ id: 1.1, status: "completed" }),
                update({ id: 1.2, status: "cancelled" }),
            ],
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.updated).toEqual([
                { id: 1.1, scope: "child", content: "Sub 1.1", status: "completed" },
                { id: 1.2, scope: "child", content: "Sub 1.2", status: "cancelled" },
            ]);
        }
    });
});

describe("TodoRules.apply — unknown and locked rows", () => {
    test("refuses an unknown id", () => {
        refuses([root(1)], update({ id: 9, status: "completed" }), "not_found");
    });

    test("refuses an unknown subtask id", () => {
        refuses(
            [root(1, { children: [child(1.1)] })],
            update({ id: 1.9, status: "completed" }),
            "not_found",
        );
    });

    test("refuses a completed row", () => {
        refuses(
            [root(1, { status: "completed" })],
            update({ id: 1, content: "edit" }),
            "item_final",
        );
    });

    test("refuses a cancelled row", () => {
        refuses(
            [root(1, { status: "cancelled" })],
            update({ id: 1, content: "edit" }),
            "item_final",
        );
    });

    test("refuses when every root is finished", () => {
        refuses(
            [root(1, { status: "completed" }), root(2, { status: "cancelled" })],
            update({ id: 1, content: "edit" }),
            "item_final",
        );
    });

    test("refuses an open subtask inside a closed root", () => {
        // Reachable from a stored list only: the root was dropped while a
        // subtask was still open. Editing it would resurrect the root.
        refuses(
            [
                root(1, {
                    status: "cancelled",
                    children: [child(1.1, { status: "pending" })],
                }),
            ],
            update({ id: 1.1, status: "completed" }),
            "list_final",
        );
    });
});

describe("TodoRules.apply — forward-only", () => {
    test("refuses in_progress back to pending", () => {
        refuses(
            [root(1, { status: "in_progress" })],
            update({ id: 1, status: "pending" }),
            "backward_transition",
        );
    });

    test("refuses error back to pending", () => {
        refuses(
            [root(1, { status: "error" })],
            update({ id: 1, status: "pending" }),
            "backward_transition",
        );
    });

    test("allows error to be repaired to in_progress", () => {
        const todos = accepts(
            [root(1, { status: "error", note: "boom" })],
            update({ id: 1, status: "in_progress" }),
        );
        expect(todos[0]?.status).toBe("in_progress");
    });

    test("allows pending straight to completed", () => {
        const todos = accepts([root(1)], update({ id: 1, status: "completed" }));
        expect(todos[0]?.status).toBe("completed");
    });
});

describe("TodoRules.apply — root order", () => {
    test("refuses to touch a later root while an earlier one is open", () => {
        refuses(
            [root(1), root(2)],
            update({ id: 2, status: "in_progress" }),
            "root_out_of_order",
        );
    });

    test("refuses a later root even when only editing its content", () => {
        refuses(
            [root(1, { status: "in_progress" }), root(2)],
            update({ id: 2, note: "x" }),
            "root_out_of_order",
        );
    });

    test("allows the first open root", () => {
        const todos = accepts(
            [root(1, { status: "completed" }), root(2)],
            update({ id: 2, status: "in_progress" }),
        );
        expect(todos[1]?.status).toBe("in_progress");
    });

    test("allows fixing an errored later root early", () => {
        const todos = accepts(
            [root(1, { status: "in_progress" }), root(2, { status: "error" })],
            update({ id: 2, note: "retrying" }),
        );
        expect(todos[1]?.note).toBe("retrying");
    });

    test("allows fixing a subtask of an errored later root without starting it", () => {
        // An errored root is fixable early, but two roots may never run at once,
        // so the repair is an edit — not `in_progress` while root 1 runs.
        const todos = accepts(
            [
                root(1, { status: "in_progress" }),
                root(2, {
                    status: "error",
                    children: [child(2.1, { status: "error" })],
                }),
            ],
            update({ id: 2.1, note: "retry after fix" }),
        );
        expect(todos[1]?.children?.[0]?.note).toBe("retry after fix");
    });

    test("refuses starting a subtask of a later errored root while one runs", () => {
        // Documented limitation: the error exception opens the *scope* of a later
        // root, but the single-active-chain rule still forbids a second
        // `in_progress`, so a broken later root cannot be worked on until the
        // running one is finished or cancelled.
        refuses(
            [
                root(1, { status: "in_progress" }),
                root(2, {
                    status: "error",
                    children: [child(2.1, { status: "error" })],
                }),
            ],
            update({ id: 2.1, status: "in_progress" }),
            "root_busy",
        );
    });

    test("a fixed subtask completing its root is refused while an earlier root is open", () => {
        // Finishing 2.1 auto-completes root 2, and root 2 may not be completed
        // while root 1 is still open. The whole-list check catches what the
        // per-row check cannot see, so the code is `list_invalid`.
        refuses(
            [
                root(1, { status: "in_progress" }),
                root(2, {
                    status: "error",
                    children: [child(2.1, { status: "error" })],
                }),
            ],
            update({ id: 2.1, status: "completed" }),
            "list_invalid",
        );
    });
});

describe("TodoRules.apply — one active chain", () => {
    test("refuses a second in_progress root", () => {
        refuses(
            [root(1, { status: "in_progress" }), root(2)],
            update({ id: 2, status: "in_progress" }),
            "root_out_of_order",
        );
    });

    test("refuses a second in_progress subtask in the same root", () => {
        refuses(
            [
                root(1, {
                    status: "in_progress",
                    children: [child(1.1, { status: "in_progress" }), child(1.2)],
                }),
            ],
            update({ id: 1.2, status: "in_progress" }),
            "child_busy",
        );
    });

    test("allows starting a subtask once its sibling finished, in one batch", () => {
        const result = TodoRules.apply(
            [
                root(1, {
                    status: "in_progress",
                    children: [child(1.1, { status: "in_progress" }), child(1.2)],
                }),
            ],
            [
                update({ id: 1.1, status: "completed" }),
                update({ id: 1.2, status: "in_progress" }),
            ],
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.todos[0]?.children?.[0]?.status).toBe("completed");
            expect(result.todos[0]?.children?.[1]?.status).toBe("in_progress");
        }
    });

    test("brings a pending parent along when a subtask starts", () => {
        const todos = accepts(
            [root(1, { children: [child(1.1)] })],
            update({ id: 1.1, status: "in_progress" }),
        );
        expect(todos[0]?.status).toBe("in_progress");
    });
});

describe("TodoRules.apply — cancel_remaining", () => {
    test("cancels pending siblings", () => {
        const result = TodoRules.apply(
            [
                root(1, {
                    status: "in_progress",
                    children: [
                        child(1.1, { status: "in_progress" }),
                        child(1.2),
                        child(1.3, { status: "completed" }),
                    ],
                }),
            ],
            [update({ id: 1.1, status: "error", cancel_remaining: true })],
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.todos[0]?.children?.map((c) => c.status)).toEqual([
                "error",
                "cancelled",
                "completed",
            ]);
        }
    });

    test("reports the cancelled rows too", () => {
        const result = TodoRules.apply(
            [root(1, { children: [child(1.1), child(1.2)] })],
            [update({ id: 1.1, status: "cancelled", cancel_remaining: true })],
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.updated.map((row) => `${row.id}:${row.status}`)).toEqual([
                "1.1:cancelled",
                "1.2:cancelled",
            ]);
        }
    });

    test("works on a root and cancels its subtasks", () => {
        const result = TodoRules.apply(
            [root(1, { children: [child(1.1), child(1.2)] })],
            [update({ id: 1, status: "cancelled", cancel_remaining: true })],
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.todos[0]?.status).toBe("cancelled");
            expect(result.todos[0]?.children?.map((c) => c.status)).toEqual([
                "cancelled",
                "cancelled",
            ]);
        }
    });

    test("refuses a status other than error or cancelled", () => {
        refuses(
            [root(1, { children: [child(1.1)] })],
            update({ id: 1, status: "in_progress", cancel_remaining: true }),
            "cancel_remaining_status",
        );
    });
});

describe("TodoRules.apply — atomicity", () => {
    test("applies nothing when the second step fails", () => {
        const todos = [root(1), root(2)];
        const result = TodoRules.apply(todos, [
            update({ id: 1, status: "in_progress" }),
            update({ id: 2, status: "in_progress" }),
        ]);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.index).toBe(1);
        // The caller's copy is untouched, so nothing leaked in.
        expect(todos[0]?.status).toBe("pending");
    });

    test("points at the failing step index", () => {
        const result = TodoRules.apply(
            [root(1)],
            [update({ id: 1, status: "in_progress" }), update({ id: 9, note: "x" })],
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.index).toBe(1);
            expect(result.error.code).toBe("not_found");
        }
    });

    test("validates each step against the previous step's result", () => {
        // Step 2 would be illegal against the original list (a root is already
        // in progress), but step 1 finishes it first.
        const result = TodoRules.apply(
            [root(1, { status: "in_progress" }), root(2)],
            [
                update({ id: 1, status: "completed" }),
                update({ id: 2, status: "in_progress" }),
            ],
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.todos[0]?.status).toBe("completed");
            expect(result.todos[1]?.status).toBe("in_progress");
        }
    });

    test("an empty batch changes nothing", () => {
        const result = TodoRules.apply([root(1)], []);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.updated).toEqual([]);
    });
});

describe("TodoRules.apply — whole-list invariants", () => {
    test("auto-completes a root once its last subtask finishes", () => {
        const todos = accepts(
            [
                root(1, {
                    status: "in_progress",
                    children: [
                        child(1.1, { status: "completed" }),
                        child(1.2, { status: "in_progress" }),
                    ],
                }),
            ],
            update({ id: 1.2, status: "completed" }),
        );
        expect(todos[0]?.status).toBe("completed");
    });

    test("refuses a subtask edit that would break the stored list", () => {
        // A stored list that is already out of order cannot be edited further:
        // the whole-list check catches what the per-row check cannot name.
        refuses(
            [root(1), root(2, { status: "completed" })],
            update({ id: 1, status: "in_progress" }),
            "list_invalid",
        );
    });
});

describe("TodoRules.checkScope errors are actionable", () => {
    test("every message names the offending row", () => {
        const cases: Array<[TodoRootItem[], TodoUpdateItem]> = [
            [[root(1), root(2)], update({ id: 2, status: "in_progress" })],
            [
                [root(1, { status: "in_progress" })],
                update({ id: 1, status: "pending" }),
            ],
            [[root(1, { status: "completed" })], update({ id: 1, note: "x" })],
        ];

        for (const [todos, upd] of cases) {
            const result = TodoRules.apply(todos, [upd]);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message.length).toBeGreaterThan(10);
                expect(result.error.id).toBe(upd.id);
            }
        }
    });
});
