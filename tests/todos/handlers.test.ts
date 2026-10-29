import { describe, expect, test } from "bun:test";
import type { TodoChildren, TodoRootItem } from "../../src/schemas/todo/item";
import type { TodoReadInput } from "../../src/schemas/todo/read";
import { handleClear, handleCreate, handleRead } from "../../src/todos/handlers";

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

const read = (input: Partial<TodoReadInput> = {}): TodoReadInput =>
    ({ operation: "read", format: "tree", scope: "all", ...input }) as TodoReadInput;

const success = <T extends { ok: boolean }>(result: T): T & { ok: true } => {
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    return result as T & { ok: true };
};

describe("handleRead", () => {
    test("renders an empty list", () => {
        expect(success(handleRead([], read())).content).toBe("No todos recorded.");
    });

    test("renders the full tree and summary", () => {
        const todos = [root(1, { status: "completed", note: "done" }), root(2)];
        expect(success(handleRead(todos, read())).content).toContain("[x] 1. ~~Task 1~~");
        expect(success(handleRead(todos, read({ format: "summary" }))).content)
            .toBe("- [x] 1 Task 1: done");
    });

    test("supports root, item, and children scopes", () => {
        const todos = [
            root(1, {
                status: "in_progress",
                children: [child(1.1, { status: "completed" }), child(1.2, { status: "in_progress" })],
            }),
            root(2),
        ];
        const branch = success(handleRead(todos, read({ scope: "root", target: 1 })));
        expect(branch.content).toContain("1.2 Sub 1.2");
        const item = success(handleRead(todos, read({ scope: "item", target: 1.2 })));
        expect(item.visibleIds).toEqual([1.2]);
        expect(item.content).toContain("1.2 Sub 1.2");
        expect(item.content).not.toContain("1. Task 1");
        const children = success(handleRead(todos, read({ scope: "children", target: 1.2 })));
        expect(children.visibleIds).toEqual([1, 1.2]);
        expect(children.content).toContain("1. Task 1");
        expect(children.content).toContain("1.2 Sub 1.2");
        expect(children.content).not.toContain("1.1 Sub 1.1");
    });

    test("refuses an unknown target", () => {
        const result = handleRead([root(1)], read({ scope: "root", target: 9 }));
        expect(result.ok).toBe(false);
        expect(result.content).toBe("No todo 9.");
    });
});

describe("handleCreate", () => {
    test("validates and returns a new list", () => {
        const result = success(handleCreate([], {
            operation: "create",
            todos: [root(1, { status: "in_progress", children: [child(1.1)] })],
        }));
        expect(result.todos).toHaveLength(1);
        expect(result.content).toContain("Sub 1.1");
    });

    test("refuses replacement while work is open", () => {
        const current = [root(1, { status: "in_progress" })];
        const result = handleCreate(current, { operation: "create", todos: [root(1)] });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("list_open");
        expect(result.todos).toEqual(current);
    });
});

describe("handleClear", () => {
    test("clears a finished list", () => {
        const result = success(handleClear([root(1, { status: "completed" })]));
        expect(result.todos).toEqual([]);
        expect(result.content).toBe("Cleared 1 todo.");
    });

    test("refuses while a child is open", () => {
        const current = [root(1, { status: "completed", children: [child(1.1)] })];
        const result = handleClear(current);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("list_open");
    });
});
