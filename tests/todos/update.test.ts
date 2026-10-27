import { describe, expect, test } from "bun:test";
import {
    MAX_UPDATES,
    TodoUpdateOperationSchema,
} from "../../src/schemas/todo/update";

const parse = (updates: unknown) =>
    TodoUpdateOperationSchema.safeParse({ operation: "update", updates });

describe("TodoUpdateOperationSchema", () => {
    describe("shape", () => {
        test("wraps a single object into an array", () => {
            const r = parse({ id: 1, status: "completed" });
            expect(r.success).toBe(true);
            if (r.success) expect(r.data.updates).toHaveLength(1);
        });

        test("keeps an array as an array", () => {
            const r = parse([
                { id: 1, status: "completed" },
                { id: 2, status: "in_progress" },
            ]);
            expect(r.success).toBe(true);
            if (r.success) expect(r.data.updates).toHaveLength(2);
        });

        test("accepts a stringified object and a stringified array", () => {
            expect(
                parse(JSON.stringify({ id: 1, status: "completed" })).success,
            ).toBe(true);
            expect(
                parse(JSON.stringify([{ id: 1, status: "completed" }])).success,
            ).toBe(true);
        });

        test("rejects missing, empty or non-object updates", () => {
            expect(
                TodoUpdateOperationSchema.safeParse({ operation: "update" }).success,
            ).toBe(false);
            expect(parse([]).success).toBe(false);
            expect(parse("not json").success).toBe(false);
            expect(parse(null).success).toBe(false);
        });

        test("rejects the wrong operation and unknown fields", () => {
            expect(
                TodoUpdateOperationSchema.safeParse({
                    operation: "write",
                    updates: { id: 1, status: "completed" },
                }).success,
            ).toBe(false);
            expect(parse({ id: 1, status: "completed", extra: true }).success).toBe(
                false,
            );
            expect(
                TodoUpdateOperationSchema.safeParse({
                    operation: "update",
                    updates: { id: 1, status: "completed" },
                    extra: 1,
                }).success,
            ).toBe(false);
        });
    });

    describe("ids", () => {
        test("accepts root and child ids, as numbers or numeric strings", () => {
            expect(parse({ id: 1, status: "completed" }).success).toBe(true);
            expect(parse({ id: 1.1, status: "completed" }).success).toBe(true);
            expect(parse({ id: "1", status: "completed" }).success).toBe(true);
            expect(parse({ id: "1.1", status: "completed" }).success).toBe(true);
        });

        test("coerces string ids to numbers", () => {
            const r = parse({ id: "1.1", status: "completed" });
            expect(r.success && r.data.updates[0]?.id).toBe(1.1);
        });

        test.each(["abc", "1e0", "", 0, -1, 1.12, null, undefined])(
            "rejects invalid id %p",
            (id) => {
                expect(parse({ id, status: "completed" }).success).toBe(false);
            },
        );
    });

    describe("fields", () => {
        test("rejects an update that changes nothing", () => {
            expect(parse({ id: 1 }).success).toBe(false);
        });

        test("status can be omitted when another field changes", () => {
            expect(parse({ id: 1, content: "New text" }).success).toBe(true);
            expect(parse({ id: 1, priority: "high" }).success).toBe(true);
            expect(parse({ id: 1, note: "x" }).success).toBe(true);
        });

        test("null counts as a change (removes priority or note)", () => {
            expect(parse({ id: 1, note: null }).success).toBe(true);
            expect(parse({ id: 1, priority: null }).success).toBe(true);
        });

        test("rejects invalid status and priority", () => {
            expect(parse({ id: 1, status: "done" }).success).toBe(false);
            expect(parse({ id: 1, priority: "urgent" }).success).toBe(false);
        });

        test("rejects empty or oversized content", () => {
            expect(parse({ id: 1, content: "" }).success).toBe(false);
            expect(parse({ id: 1, content: "   " }).success).toBe(false);
            expect(parse({ id: 1, content: "x".repeat(501) }).success).toBe(false);
            expect(parse({ id: 1, content: "x".repeat(500) }).success).toBe(true);
        });

        test("rejects oversized note", () => {
            expect(parse({ id: 1, note: "x".repeat(1001) }).success).toBe(false);
            expect(parse({ id: 1, note: "x".repeat(1000) }).success).toBe(true);
        });
    });

    describe("cancel_remaining", () => {
        test("accepted with status cancelled", () => {
            expect(
                parse({ id: 1, status: "cancelled", cancel_remaining: true }).success,
            ).toBe(true);
        });

        test.each(["completed", "pending", "in_progress", "error"])(
            "rejected with status %s",
            (status) => {
                expect(parse({ id: 1, status, cancel_remaining: true }).success).toBe(
                    false,
                );
            },
        );

        test("rejected without a status", () => {
            expect(parse({ id: 1, cancel_remaining: true }).success).toBe(false);
            expect(parse({ id: 1, note: "x", cancel_remaining: true }).success).toBe(
                false,
            );
        });

        test("false is always fine", () => {
            expect(
                parse({ id: 1, status: "completed", cancel_remaining: false }).success,
            ).toBe(true);
        });
    });

    describe("batch rules", () => {
        test("accepts finish-then-start", () => {
            expect(
                parse([
                    { id: 1, status: "completed" },
                    { id: 2, status: "in_progress" },
                ]).success,
            ).toBe(true);
        });

        test("accepts a root and one of its subtasks as different ids", () => {
            expect(
                parse([
                    { id: 1, note: "a" },
                    { id: 1.1, note: "b" },
                ]).success,
            ).toBe(true);
        });

        test("rejects duplicate ids, including after coercion", () => {
            expect(
                parse([
                    { id: 1, status: "completed" },
                    { id: 1, note: "x" },
                ]).success,
            ).toBe(false);
            expect(
                parse([
                    { id: 1, status: "completed" },
                    { id: "1", note: "x" },
                ]).success,
            ).toBe(false);
        });

        test("rejects two in_progress in one call", () => {
            expect(
                parse([
                    { id: 1, status: "in_progress" },
                    { id: 2, status: "in_progress" },
                ]).success,
            ).toBe(false);
        });

        test("allows several non-in_progress statuses together", () => {
            expect(
                parse([
                    { id: 1, status: "completed" },
                    { id: 2, status: "cancelled" },
                    { id: 3, status: "error" },
                ]).success,
            ).toBe(true);
        });

        test("enforces the batch limit", () => {
            const items = Array.from({ length: MAX_UPDATES + 1 }, (_, i) => ({
                id: i + 1,
                note: "x",
            }));
            expect(parse(items).success).toBe(false);
            expect(parse(items.slice(0, MAX_UPDATES)).success).toBe(true);
        });
    });
});
