import { describe, expect, test } from "bun:test";
import { TodoCreateOperationSchema } from "../../src/schemas/todo/create";

const parse = (todos: unknown) =>
    TodoCreateOperationSchema.safeParse({ operation: "create", todos });

const root = (id: number | string, extra: Record<string, unknown> = {}) => ({
    id,
    content: `Task ${id}`,
    status: "pending",
    ...extra,
});

const child = (id: number | string, extra: Record<string, unknown> = {}) => ({
    id,
    content: `Sub ${id}`,
    status: "pending",
    ...extra,
});

const MAX_ROOTS = 50; // keep in sync with item.ts

describe("TodoCreateOperationSchema", () => {
    describe("accepts", () => {
        test("a single root", () => {
            expect(parse([root(1)]).success).toBe(true);
        });

        test("a root with children, priority and note", () => {
            expect(
                parse([
                    root(1, {
                        priority: "high",
                        note: "context",
                        children: [child(1.1), child(1.2, { priority: "low" })],
                    }),
                ]).success,
            ).toBe(true);
        });

        test("several roots", () => {
            expect(parse([root(1), root(2), root(3)]).success).toBe(true);
        });

        test("a stringified list", () => {
            expect(parse(JSON.stringify([root(1)])).success).toBe(true);
        });

        test("string ids, coerced to numbers", () => {
            const r = parse([root("1", { children: [child("1.1")] })]);
            expect(r.success).toBe(true);
            if (r.success) {
                expect(r.data.todos[0]?.id).toBe(1);
                expect(r.data.todos[0]?.children?.[0]?.id).toBe(1.1);
            }
        });

        test("content of exactly the max length", () => {
            expect(parse([root(1, { content: "x".repeat(500) })]).success).toBe(true);
        });

        test("exactly 9 children and MAX_ROOTS roots", () => {
            const nine = Array.from({ length: 9 }, (_, i) => child(1 + (i + 1) / 10));
            expect(parse([root(1, { children: nine })]).success).toBe(true);

            const many = Array.from({ length: MAX_ROOTS }, (_, i) => root(i + 1));
            expect(parse(many).success).toBe(true);
        });
    });

    describe("rejects: list shape", () => {
        test("empty array", () => {
            expect(parse([]).success).toBe(false);
        });

        test("stringified empty array", () => {
            expect(parse("[]").success).toBe(false);
        });

        test("missing todos", () => {
            expect(
                TodoCreateOperationSchema.safeParse({ operation: "create" }).success,
            ).toBe(false);
        });

        test("non-array todos", () => {
            expect(parse("not json").success).toBe(false);
            expect(parse(null).success).toBe(false);
            expect(parse(root(1)).success).toBe(false);
        });

        test("more than MAX_ROOTS roots", () => {
            const tooMany = Array.from({ length: MAX_ROOTS + 1 }, (_, i) =>
                root(i + 1),
            );
            expect(parse(tooMany).success).toBe(false);
        });

        test("duplicate root ids (including after coercion)", () => {
            expect(parse([root(1), root(1)]).success).toBe(false);
            expect(parse([root(1), root("1")]).success).toBe(false);
        });
    });

    describe("rejects: operation and fields", () => {
        test("the removed write operation", () => {
            expect(
                TodoCreateOperationSchema.safeParse({
                    operation: "write",
                    todos: [root(1)],
                }).success,
            ).toBe(false);
        });

        test("unknown top-level field", () => {
            expect(
                TodoCreateOperationSchema.safeParse({
                    operation: "create",
                    todos: [root(1)],
                    extra: 1,
                }).success,
            ).toBe(false);
        });

        test("unknown field on a root or child", () => {
            expect(parse([root(1, { extra: true })]).success).toBe(false);
            expect(
                parse([root(1, { children: [child(1.1, { extra: true })] })]).success,
            ).toBe(false);
        });

        test("invalid status and priority", () => {
            expect(parse([root(1, { status: "done" })]).success).toBe(false);
            expect(parse([root(1, { priority: "urgent" })]).success).toBe(false);
        });
    });

    describe("rejects: text limits", () => {
        test("empty or whitespace-only content", () => {
            expect(parse([root(1, { content: "" })]).success).toBe(false);
            expect(parse([root(1, { content: "   " })]).success).toBe(false);
            expect(
                parse([root(1, { children: [child(1.1, { content: " " })] })]).success,
            ).toBe(false);
        });

        test("content over the limit", () => {
            expect(parse([root(1, { content: "x".repeat(501) })]).success).toBe(
                false,
            );
        });

        test("note over the limit", () => {
            expect(parse([root(1, { note: "x".repeat(1001) })]).success).toBe(false);
        });
    });

    describe("rejects: ids", () => {
        test.each([1.1, "1.1", "1.0", "1e0", 0, -1])(
            "non-root id %p on a root",
            (id) => {
                expect(parse([root(id)]).success).toBe(false);
            },
        );

        test("child id with another root's prefix", () => {
            expect(parse([root(1, { children: [child(2.1)] })]).success).toBe(false);
        });

        test("child id without a decimal part", () => {
            expect(parse([root(1, { children: [child(1)] })]).success).toBe(false);
        });

        test("child id with more than one decimal digit", () => {
            expect(parse([root(1, { children: [child(1.12)] })]).success).toBe(false);
        });

        test("duplicate child ids", () => {
            expect(
                parse([
                    root(1, { children: [child(1.1), child(1.1, { content: "Other" })] }),
                ]).success,
            ).toBe(false);
        });
    });

    describe("rejects: children", () => {
        test("empty children array", () => {
            expect(parse([root(1, { children: [] })]).success).toBe(false);
        });

        test("more than 9 children", () => {
            const ten = Array.from({ length: 10 }, (_, i) =>
                child(1 + ((i % 9) + 1) / 10, { content: `Sub ${i}` }),
            );
            expect(parse([root(1, { children: ten })]).success).toBe(false);
        });

        test("stringified children are accepted, invalid ones rejected", () => {
            expect(
                parse([root(1, { children: JSON.stringify([child(1.1)]) })]).success,
            ).toBe(true);
            expect(
                parse([root(1, { children: JSON.stringify([child(2.1)]) })]).success,
            ).toBe(false);
        });
    });
});
