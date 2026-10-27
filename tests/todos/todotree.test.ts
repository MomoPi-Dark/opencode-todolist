import { describe, expect, test } from "bun:test";
import type { TodoChildren, TodoRootItem } from "../../src/schemas/todo/item";
import { TodoTree } from "../../src/todos/todo-tree";

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

const validate = (todos: TodoRootItem[]) =>
    TodoTree.validateAndNormalize(todos);

/** Cheap assertion: the message has to name the row that broke the rule. */
const expectsMessage = (todos: TodoRootItem[], fragment: string) => {
    const result = validate(todos);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain(fragment);
};

describe("TodoTree.validateAndNormalize", () => {
    describe("valid lists", () => {
        test("accepts an empty list", () => {
            const result = validate([]);
            expect(result.valid).toBe(true);
        });

        test("accepts a single pending root", () => {
            const result = validate([root(1)]);
            expect(result.valid).toBe(true);
        });

        test("accepts a root with subtasks and an open chain", () => {
            const result = validate([
                root(1, {
                    status: "in_progress",
                    children: [
                        child(1.1, { status: "completed" }),
                        child(1.2, { status: "in_progress" }),
                        child(1.3),
                    ],
                }),
                root(2),
            ]);
            expect(result.valid).toBe(true);
        });

        test("accepts cancelled rows", () => {
            const result = validate([
                root(1, {
                    status: "cancelled",
                    children: [
                        child(1.1, { status: "cancelled" }),
                        child(1.2, { status: "cancelled" }),
                    ],
                }),
                root(2),
            ]);
            expect(result.valid).toBe(true);
        });

        test("accepts an error row after an open root", () => {
            const result = validate([
                root(1),
                root(2, { status: "error", note: "build failed" }),
            ]);
            expect(result.valid).toBe(true);
        });

        test("accepts a note and a priority", () => {
            const result = validate([
                root(1, {
                    priority: "high",
                    note: "src/auth.ts",
                    children: [child(1.1, { priority: "low", note: "tests" })],
                }),
            ]);
            expect(result.valid).toBe(true);
        });
    });

    describe("ids", () => {
        test("rejects duplicate root ids", () => {
            expectsMessage([root(1), root(1)], "Duplicate ID found: '1'");
        });

        test("rejects duplicate subtask ids inside one root", () => {
            expectsMessage(
                [root(1, { children: [child(1.1), child(1.1)] })],
                "Duplicate ID found: '1.1'",
            );
        });

        test("rejects a subtask whose id belongs to another root", () => {
            expectsMessage(
                [root(1, { children: [child(2.1)] })],
                "Subtask id 2.1 must start with 1",
            );
        });

        test("rejects more subtasks than MAX_CHILDREN", () => {
            const children = [...Array(10)].map((_, i) =>
                child(Number(`1.${i + 1}`)),
            );
            expectsMessage([root(1, { children })], "At most 9 are allowed");
        });
    });

    describe("concurrency", () => {
        test("rejects two roots in progress", () => {
            expectsMessage(
                [
                    root(1, { status: "in_progress" }),
                    root(2, { status: "in_progress" }),
                ],
                "Only 1 top-level task can be 'in_progress'",
            );
        });

        test("rejects two subtasks in progress in one root", () => {
            expectsMessage(
                [
                    root(1, {
                        status: "in_progress",
                        children: [
                            child(1.1, { status: "in_progress" }),
                            child(1.2, { status: "in_progress" }),
                        ],
                    }),
                ],
                "2 subtasks 'in_progress'. At most 1 is allowed",
            );
        });

        test("rejects an in-progress subtask whose parent is not in progress", () => {
            expectsMessage(
                [
                    root(1, {
                        status: "pending",
                        children: [child(1.1, { status: "in_progress" })],
                    }),
                ],
                "Set parent to 'in_progress' first",
            );
        });

        test("allows an in-progress subtask under an in-progress parent", () => {
            const result = validate([
                root(1, {
                    status: "in_progress",
                    children: [child(1.1, { status: "in_progress" })],
                }),
            ]);
            expect(result.valid).toBe(true);
        });
    });

    describe("root order", () => {
        test("rejects a completed root after an open root", () => {
            expectsMessage(
                [root(1), root(2, { status: "completed" })],
                "Roots run in order",
            );
        });

        test("rejects an in-progress root after an open root", () => {
            expectsMessage(
                [root(1), root(2, { status: "in_progress" })],
                "Roots run in order",
            );
        });

        test("rejects a cancelled root after an open root", () => {
            expectsMessage(
                [root(1), root(2, { status: "cancelled" })],
                "Roots run in order",
            );
        });

        test("allows several closed roots followed by an open one", () => {
            const result = validate([
                root(1, { status: "completed" }),
                root(2, { status: "cancelled" }),
                root(3),
            ]);
            expect(result.valid).toBe(true);
        });
    });

    describe("auto-complete", () => {
        test("raises a root to completed when every subtask is completed", () => {
            const result = validate([
                root(1, {
                    status: "in_progress",
                    children: [
                        child(1.1, { status: "completed" }),
                        child(1.2, { status: "completed" }),
                    ],
                }),
            ]);
            expect(result.valid).toBe(true);
            if (result.valid) expect(result.data[0]?.status).toBe("completed");
        });

        test("does not raise a root while a subtask is cancelled", () => {
            const result = validate([
                root(1, {
                    status: "in_progress",
                    children: [
                        child(1.1, { status: "completed" }),
                        child(1.2, { status: "cancelled" }),
                    ],
                }),
            ]);
            expect(result.valid).toBe(true);
            if (result.valid) expect(result.data[0]?.status).toBe("in_progress");
        });

        test("rejects a completed root that still has unfinished subtasks", () => {
            expectsMessage(
                [
                    root(1, {
                        status: "completed",
                        children: [child(1.1), child(1.2, { status: "completed" })],
                    }),
                ],
                "cannot be marked 'completed'",
            );
        });

        test("runs the order check after the promotion", () => {
            // Root 1 finishes through the promotion, so root 2 becomes legal.
            const result = validate([
                root(1, {
                    status: "in_progress",
                    children: [child(1.1, { status: "completed" })],
                }),
                root(2, { status: "completed" }),
            ]);
            expect(result.valid).toBe(true);
        });

        test("does not mutate the list it was given", () => {
            const todos = [
                root(1, {
                    status: "in_progress",
                    children: [child(1.1, { status: "completed" })],
                }),
            ];
            validate(todos);
            expect(todos[0]?.status).toBe("in_progress");
        });
    });

    test("reports the structural error before the order rule", () => {
        // Structural checks run first: a duplicate id is reported even though
        // the same list also breaks the root-order rule.
        const result = validate([root(1), root(1, { status: "completed" })]);
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.error).toContain("Duplicate ID found");
    });
});

describe("TodoTree.calculateStats", () => {
    test("counts subtasks as the units of work", () => {
        const stats = TodoTree.calculateStats([
            root(1, {
                status: "in_progress",
                children: [
                    child(1.1, { status: "completed" }),
                    child(1.2, { status: "in_progress" }),
                ],
            }),
            root(2),
        ]);

        expect(stats.totalSteps).toBe(2);
        expect(stats.completedSteps).toBe(0);
        expect(stats.totalSubTasks).toBe(3);
        expect(stats.completedSubTasks).toBe(1);
        expect(stats.percent).toBe(33);
    });

    test("counts a root without subtasks as one unit", () => {
        const stats = TodoTree.calculateStats([root(1, { status: "completed" })]);
        expect(stats.totalSubTasks).toBe(1);
        expect(stats.completedSubTasks).toBe(1);
        expect(stats.percent).toBe(100);
    });

    test("skips cancelled rows", () => {
        const stats = TodoTree.calculateStats([
            root(1, { status: "cancelled" }),
            root(2, {
                children: [
                    child(2.1, { status: "completed" }),
                    child(2.2, { status: "cancelled" }),
                ],
            }),
        ]);

        expect(stats.totalSubTasks).toBe(1);
        expect(stats.completedSubTasks).toBe(1);
        expect(stats.percent).toBe(100);
    });

    test("reports 0 percent for an empty list", () => {
        const stats = TodoTree.calculateStats([]);
        expect(stats.totalSubTasks).toBe(0);
        expect(stats.percent).toBe(0);
    });
});

describe("TodoTree.calculateProgress", () => {
    test("returns null without subtasks", () => {
        expect(TodoTree.calculateProgress()).toBeNull();
        expect(TodoTree.calculateProgress([])).toBeNull();
    });

    test("labels completed over non-cancelled", () => {
        expect(
            TodoTree.calculateProgress([
                child(1.1, { status: "completed" }),
                child(1.2, { status: "cancelled" }),
                child(1.3),
            ]),
        ).toEqual({ completed: 1, total: 2, label: "1/2" });
    });
});

describe("TodoTree leaves", () => {
    const todos = [
        root(1, {
            status: "in_progress",
            children: [
                child(1.1, { status: "completed", note: "created: a.ts" }),
                child(1.2, { status: "in_progress" }),
                child(1.3, { status: "cancelled" }),
            ],
        }),
        root(2, { status: "completed" }),
        root(3, { status: "cancelled" }),
    ];

    test("lists work units, subtasks over their root", () => {
        expect(TodoTree.leaves(todos).map((leaf) => leaf.id)).toEqual([
            1.1, 1.2, 2,
        ]);
    });

    test("drops cancelled subtasks", () => {
        expect(TodoTree.leaves(todos).some((leaf) => leaf.id === 1.3)).toBe(false);
    });

    test("carries depth, root id and note", () => {
        expect(TodoTree.leaves(todos)[0]).toEqual({
            id: 1.1,
            content: "Sub 1.1",
            status: "completed",
            depth: 1,
            rootId: 1,
            note: "created: a.ts",
        });
    });

    test("openLeaves() keeps only open rows", () => {
        expect(TodoTree.openLeaves(todos).map((leaf) => leaf.id)).toEqual([1.2]);
    });

    test("hasOpen() follows roots and subtasks", () => {
        expect(TodoTree.hasOpen(todos)).toBe(true);
        expect(TodoTree.hasOpen([root(1, { status: "completed" })])).toBe(false);
    });
});

describe("TodoTree.find", () => {
    const todos = [root(1, { children: [child(1.1), child(1.2)] }), root(2)];

    test("finds a root at depth 0", () => {
        const found = TodoTree.find(todos, 1);
        expect(found?.depth).toBe(0);
        expect(found?.item.id).toBe(1);
        expect(found?.parent).toBeUndefined();
    });

    test("finds a subtask together with its root", () => {
        const found = TodoTree.find(todos, 1.2);
        expect(found?.depth).toBe(1);
        expect(found?.item.id).toBe(1.2);
        expect(found?.root.id).toBe(1);
        expect(found?.parent?.id).toBe(1);
    });

    test("returns null for an unknown id", () => {
        expect(TodoTree.find(todos, 9)).toBeNull();
        expect(TodoTree.find(todos, 1.9)).toBeNull();
    });
});

describe("TodoTree.render", () => {
    const todos = [
        root(1, {
            status: "in_progress",
            note: "src/auth.ts",
            children: [
                child(1.1, { status: "completed", note: "created: a.ts" }),
                child(1.2, { status: "in_progress" }),
            ],
        }),
        root(2, { status: "pending" }),
    ];

    test("prints icons, ids, progress and notes", () => {
        expect(TodoTree.render(todos)).toBe(
            [
                "[~] 1. Task 1 (1/2)",
                "    ↳ note: src/auth.ts",
                "    [x] 1.1 ~~Sub 1.1~~",
                "        ↳ note: created: a.ts",
                "    [~] 1.2 Sub 1.2",
                "[ ] 2. Task 2",
            ].join("\n"),
        );
    });

    test("uses one glyph per status", () => {
        const rendered = TodoTree.render([
            root(1, { status: "completed" }),
            root(2, { status: "cancelled" }),
            root(3, { status: "error" }),
            root(4, { status: "pending" }),
        ]);

        expect(rendered.split("\n")).toEqual([
            "[x] 1. ~~Task 1~~",
            "[-] 2. Task 2",
            "[!] 3. Task 3",
            "[ ] 4. Task 4",
        ]);
    });

    test("does not repeat an id the content already carries", () => {
        const rendered = TodoTree.render([
            root(1, { content: "1. Already prefixed", status: "completed" }),
        ]);

        expect(rendered).toBe("[x] ~~1. Already prefixed~~");
    });

    test("visibleIds narrows the rows but keeps the real progress label", () => {
        const rendered = TodoTree.render(todos, { visibleIds: [1, 1.2] });

        expect(rendered).toBe(
            [
                "[~] 1. Task 1 (1/2)",
                "    ↳ note: src/auth.ts",
                "    [~] 1.2 Sub 1.2",
            ].join("\n"),
        );
    });

    test("visibleIds that match nothing renders an empty string", () => {
        expect(TodoTree.render(todos, { visibleIds: [99] })).toBe("");
    });
});

describe("TodoTree.renderSummary", () => {
    test("lists only completed rows with their notes", () => {
        const summary = TodoTree.renderSummary([
            root(1, {
                status: "completed",
                note: "migrated",
                children: [
                    child(1.1, { status: "completed", note: "created: a.ts" }),
                    child(1.2),
                ],
            }),
            root(2),
        ]);

        expect(summary).toBe(
            ["- [x] 1 Task 1: migrated", "- [x] 1.1 Sub 1.1: created: a.ts"].join(
                "\n",
            ),
        );
    });

    test("says so when nothing is completed", () => {
        expect(TodoTree.renderSummary([root(1)])).toBe("No completed tasks yet.");
    });

    test("honours visibleIds", () => {
        const summary = TodoTree.renderSummary(
            [
                root(1, {
                    status: "completed",
                    children: [child(1.1, { status: "completed" })],
                }),
            ],
            { visibleIds: [1.1] },
        );

        expect(summary).toBe("- [x] 1.1 Sub 1.1");
    });
});
