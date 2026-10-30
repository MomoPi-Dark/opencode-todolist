import { describe, expect, test } from "bun:test";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import type { TodoStatus } from "../../src/schemas/todo/status";
import { getTodoDisplaySummary } from "../../src/todos/utils/display";
import { buildTodoRows } from "../../src/todos/utils/rows";
import { asBusyEvent, nextBusy, type BusyEvent } from "../../src/ui/busy";

const rootItem = (
    id: number,
    status: TodoStatus,
    children: TodoRootItem["children"] = [],
): TodoRootItem =>
    ({
        id,
        content: `Root ${id}`,
        status,
        ...(children.length > 0 ? { children } : {}),
    }) as TodoRootItem;

const childItem = (id: number, status: TodoStatus) =>
    ({ id, content: `Child ${id}`, status }) as NonNullable<
        TodoRootItem["children"]
    >[number];

describe("GUI panel renders children while a run is active", () => {
    // Root 1 is running with one running child; the rest are untouched.
    const running: TodoRootItem[] = [
        rootItem(1, "in_progress", [
            childItem(1.1, "in_progress"),
            childItem(1.2, "pending"),
        ]),
        rootItem(2, "pending", [childItem(2.1, "pending")]),
    ];

    test("children appear in the flat list under their root", () => {
        const summary = getTodoDisplaySummary(running);
        expect(summary).not.toBeNull();
        expect(summary!.items.map((item) => item.id)).toEqual([
            1, 1.1, 1.2, 2, 2.1,
        ]);
    });

    test("a child is marked depth 1 and carries its running status", () => {
        const summary = getTodoDisplaySummary(running)!;
        const running1 = summary.items.find((item) => item.id === 1.1)!;

        expect(running1.depth).toBe(1);
        expect(running1.status).toBe("in_progress");
    });

    test("the running root is expanded, so its children reach the view", () => {
        const summary = getTodoDisplaySummary(running)!;
        const rows = buildTodoRows(summary.items, []);

        expect(rows.map((row) => row.item.id)).toEqual([1, 1.1, 1.2, 2, 2.1]);
        expect(rows[0]).toMatchObject({ expandable: true, collapsed: false });
    });

    test("exactly the running child qualifies for the spinner", () => {
        const summary = getTodoDisplaySummary(running)!;
        const rows = buildTodoRows(summary.items, []);
        // Mirrors the panel predicate: `busy && status === "in_progress"`.
        const spinning = rows
            .filter((row) => row.item.status === "in_progress")
            .map((row) => row.item.id);

        expect(spinning).toEqual([1, 1.1]);
        expect(spinning).toContain(1.1);
    });

    test("a completed root collapses and hides its children", () => {
        const done: TodoRootItem[] = [
            rootItem(1, "completed", [
                childItem(1.1, "completed"),
                childItem(1.2, "cancelled"),
            ]),
            rootItem(2, "in_progress", [childItem(2.1, "in_progress")]),
        ];
        const rows = buildTodoRows(getTodoDisplaySummary(done)!.items, []);

        // Root 1's children are folded away; root 2 keeps its running child.
        expect(rows.map((row) => row.item.id)).toEqual([1, 2, 2.1]);
        expect(rows[1]).toMatchObject({ expandable: true, collapsed: false });
    });
});

describe("nextBusy keeps the spinner honest", () => {
    test("a started execution turns the spinner on", () => {
        expect(nextBusy({ type: "session.execution.started" })).toBe(true);
    });

    test("every finished or interrupted execution turns it off", () => {
        const terminal: BusyEvent["type"][] = [
            "session.execution.succeeded",
            "session.execution.failed",
            "session.execution.interrupted",
        ];

        for (const type of terminal) {
            expect(nextBusy({ type } as BusyEvent)).toBe(false);
        }
    });

    test("a manual stop clears the spinner", () => {
        // The regression: a stop arrives as an idle status, not as an
        // interrupted execution, so the spinner used to run forever.
        expect(nextBusy({ type: "session.idle" })).toBe(false);
        expect(
            nextBusy({
                type: "session.status",
                data: { status: { type: "idle" } },
            }),
        ).toBe(false);
    });

    test("a working status keeps the spinner on", () => {
        for (const type of ["busy", "running", "retry"]) {
            expect(
                nextBusy({ type: "session.status", data: { status: { type } } }),
            ).toBe(true);
        }
    });
});

describe("asBusyEvent narrows client events", () => {
    test("an idle status survives narrowing with its status intact", () => {
        const narrowed = asBusyEvent({
            type: "session.status",
            data: { sessionID: "ses_1", status: { type: "idle" } },
        });

        expect(narrowed).toEqual({
            type: "session.status",
            data: { status: { type: "idle" } },
            sessionID: "ses_1",
        });
        expect(nextBusy(narrowed!)).toBe(false);
    });

    test("execution events are carried without their payload", () => {
        const narrowed = asBusyEvent({
            type: "session.execution.started",
            data: { sessionID: "ses_1" },
        });

        expect(narrowed).toEqual({
            type: "session.execution.started",
            sessionID: "ses_1",
        });
        expect(nextBusy(narrowed!)).toBe(true);
    });

    test("a status event without a status is ignored", () => {
        expect(
            asBusyEvent({ type: "session.status", data: { sessionID: "ses_1" } }),
        ).toBeUndefined();
    });

    test("unrelated events are ignored", () => {
        expect(asBusyEvent({ type: "server.connected", data: {} })).toBeUndefined();
    });
});
