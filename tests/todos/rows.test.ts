import { describe, expect, test } from "bun:test";
import type { TodoStatus } from "../../src/schemas/todo/status";
import type { TodoRowSource } from "../../src/todos/utils/rows";
import {
    buildTodoRows,
    collectParents,
    defaultCollapsed,
    resolveCollapsed,
} from "../../src/todos/utils/rows";

const root = (
    id: number,
    status: TodoStatus,
    note?: string,
): TodoRowSource => ({
    id,
    content: `Root ${id}`,
    status,
    depth: 0,
    ...(note ? { note } : {}),
});

const child = (id: number, status: TodoStatus, note?: string): TodoRowSource => ({
    id,
    content: `Child ${id}`,
    status,
    depth: 1,
    ...(note ? { note } : {}),
});

describe("defaultCollapsed", () => {
    test("a completed root with children collapses", () => {
        expect(defaultCollapsed("completed", true)).toBe(true);
    });

    test("a completed root without children cannot collapse", () => {
        expect(defaultCollapsed("completed", false)).toBe(false);
    });

    test("any other status with children stays expanded", () => {
        for (const status of ["pending", "in_progress", "error", "cancelled"] as const) {
            expect(defaultCollapsed(status, true)).toBe(false);
        }
    });
});

describe("resolveCollapsed", () => {
    test("without a toggle the default applies", () => {
        expect(resolveCollapsed("completed", true, false)).toBe(true);
        expect(resolveCollapsed("pending", true, false)).toBe(false);
    });

    test("a toggle inverts the default instead of forcing one state", () => {
        expect(resolveCollapsed("completed", true, true)).toBe(false);
        expect(resolveCollapsed("pending", true, true)).toBe(true);
    });
});

describe("collectParents", () => {
    test("collects every root that owns a child", () => {
        const items = [
            root(1, "pending"),
            child(1.1, "pending"),
            root(2, "pending"),
            child(2.1, "pending"),
            root(3, "pending"),
        ];
        expect([...collectParents(items)]).toEqual([1, 2]);
    });

    test("a list without children has no parents", () => {
        expect(collectParents([root(1, "pending"), root(2, "pending")])).toEqual(
            new Set(),
        );
    });
});

describe("buildTodoRows", () => {
    const items = [
        root(1, "completed"),
        child(1.1, "completed"),
        root(2, "pending"),
        child(2.1, "pending"),
    ];

    test("a completed root starts collapsed and hides its children", () => {
        const rows = buildTodoRows(items, []);
        expect(rows.map((r) => r.item.id)).toEqual([1, 2, 2.1]);
        expect(rows[0]).toMatchObject({ expandable: true, collapsed: true });
        expect(rows[2]).toMatchObject({ expandable: false, collapsed: false });
    });

    test("one toggle expands a collapsed root", () => {
        const rows = buildTodoRows(items, [1]);
        expect(rows.map((r) => r.item.id)).toEqual([1, 1.1, 2, 2.1]);
        expect(rows[0]).toMatchObject({ expandable: true, collapsed: false });
    });

    test("a toggle expands a root that is expanded by default", () => {
        const rows = buildTodoRows(items, [2]);
        expect(rows.map((r) => r.item.id)).toEqual([1, 2]);
        expect(rows[1]).toMatchObject({ expandable: true, collapsed: true });
    });

    test("children of a collapsed root never render", () => {
        const rows = buildTodoRows(
            [root(1, "completed"), child(1.1, "pending"), child(1.2, "pending")],
            [],
        );
        expect(rows.map((r) => r.item.id)).toEqual([1]);
    });

    test("an empty list yields no rows", () => {
        expect(buildTodoRows([], [])).toEqual([]);
    });

    test("a note is carried through untouched and stays optional", () => {
        const rows = buildTodoRows(
            [root(1, "pending", "wip"), root(2, "pending")],
            [],
        );
        expect(rows[0].item.note).toBe("wip");
        expect(rows[1].item.note).toBeUndefined();
    });

    test("an empty-string note stays absent-ish and does not throw", () => {
        const rows = buildTodoRows([root(1, "pending", "")], []);
        expect(rows).toHaveLength(1);
        expect(rows[0].item.note).toBeUndefined();
    });
});
