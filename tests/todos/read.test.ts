import { describe, expect, test } from "bun:test";
import { TodoReadOperationSchema } from "../../src/schemas/todo/read";

const parse = (input: unknown) => TodoReadOperationSchema.safeParse(input);

describe("TodoReadOperationSchema", () => {
    describe("scope: all", () => {
        // Key test: depends on `unionFallback` resolving a missing discriminator.
        test("bare { operation: 'read' } defaults to scope all + format tree", () => {
            const r = parse({ operation: "read" });
            expect(r.success).toBe(true);
            if (r.success) {
                expect(r.data.scope).toBe("all");
                expect(r.data.format).toBe("tree");
            }
        });

        test("accepts explicit scope all", () => {
            expect(parse({ operation: "read", scope: "all" }).success).toBe(true);
        });

        test("rejects target together with scope all", () => {
            expect(
                parse({ operation: "read", scope: "all", target: 1 }).success,
            ).toBe(false);
        });

        test("rejects target without scope", () => {
            expect(parse({ operation: "read", target: 1 }).success).toBe(false);
        });
    });

    describe("format", () => {
        test("accepts tree and summary", () => {
            expect(parse({ operation: "read", format: "tree" }).success).toBe(true);
            expect(parse({ operation: "read", format: "summary" }).success).toBe(
                true,
            );
        });

        test("rejects unknown format", () => {
            expect(parse({ operation: "read", format: "json" }).success).toBe(false);
        });

        test("applies to every scope", () => {
            expect(
                parse({
                    operation: "read",
                    scope: "item",
                    target: 1,
                    format: "summary",
                }).success,
            ).toBe(true);
            expect(
                parse({
                    operation: "read",
                    scope: "root",
                    target: 1,
                    format: "summary",
                }).success,
            ).toBe(true);
        });
    });

    describe("scope: item", () => {
        test("accepts root and child ids", () => {
            expect(
                parse({ operation: "read", scope: "item", target: 1 }).success,
            ).toBe(true);
            expect(
                parse({ operation: "read", scope: "item", target: 1.1 }).success,
            ).toBe(true);
        });

        test("coerces numeric strings", () => {
            const root = parse({ operation: "read", scope: "item", target: "1" });
            const child = parse({ operation: "read", scope: "item", target: "1.1" });
            expect(
                root.success && root.data.scope === "item" && root.data.target,
            ).toBe(1);
            expect(
                child.success && child.data.scope === "item" && child.data.target,
            ).toBe(1.1);
        });

        test("requires target", () => {
            expect(parse({ operation: "read", scope: "item" }).success).toBe(false);
        });

        test.each(["abc", "1e0", "0x1", "", 0, -1, 1.12])(
            "rejects invalid target %p",
            (target) => {
                expect(
                    parse({ operation: "read", scope: "item", target }).success,
                ).toBe(false);
            },
        );
    });

    describe("scope: root", () => {
        test("accepts a root id", () => {
            expect(
                parse({ operation: "read", scope: "root", target: 1 }).success,
            ).toBe(true);
            expect(
                parse({ operation: "read", scope: "root", target: "2" }).success,
            ).toBe(true);
        });

        test("requires target", () => {
            expect(parse({ operation: "read", scope: "root" }).success).toBe(false);
        });

        test.each([1.1, "1.1", "1.0", "1e0", 0, -1])(
            "rejects non-root target %p",
            (target) => {
                expect(
                    parse({ operation: "read", scope: "root", target }).success,
                ).toBe(false);
            },
        );
    });

    describe("invalid input", () => {
        test("rejects removed scope children", () => {
            expect(
                parse({ operation: "read", scope: "children", target: 1.1 }).success,
            ).toBe(false);
        });

        test("rejects unknown scope", () => {
            expect(parse({ operation: "read", scope: "everything" }).success).toBe(
                false,
            );
        });

        test("rejects wrong operation", () => {
            expect(parse({ operation: "write" }).success).toBe(false);
        });

        test("rejects unknown fields", () => {
            expect(
                parse({ operation: "read", scope: "all", extra: true }).success,
            ).toBe(false);
        });
    });
});
