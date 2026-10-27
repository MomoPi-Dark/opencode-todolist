import { describe, expect, test } from "bun:test";
import { TodoInputToolSchema } from "../../src/schemas/todo";
import { TodoClearOperationSchema } from "../../src/schemas/todo/clear";

const parse = (input: unknown) => TodoClearOperationSchema.safeParse(input);

describe("TodoClearOperationSchema", () => {
    describe("accepts", () => {
        test("operation clear with confirm true", () => {
            const r = parse({ operation: "clear", confirm: true });
            expect(r.success).toBe(true);
            if (r.success)
                expect(r.data).toEqual({ operation: "clear", confirm: true });
        });
    });

    describe("rejects: confirm", () => {
        test.each([false, "true", "yes", 1, 0, null, {}])(
            "confirm %p",
            (confirm) => {
                expect(parse({ operation: "clear", confirm }).success).toBe(false);
            },
        );

        test("confirm [] (empty array)", () => {
            expect(parse({ operation: "clear", confirm: [] }).success).toBe(false);
        });

        test("missing confirm", () => {
            expect(parse({ operation: "clear" }).success).toBe(false);
        });

        test("error message tells the model what to pass", () => {
            const r = parse({ operation: "clear", confirm: false });
            expect(r.success).toBe(false);
            if (!r.success) {
                expect(r.error.issues[0]?.message).toContain("confirm: true");
            }
        });
    });

    describe("rejects: shape", () => {
        test("wrong operation", () => {
            expect(parse({ operation: "create", confirm: true }).success).toBe(false);
            expect(parse({ operation: "write", confirm: true }).success).toBe(false);
        });

        test("missing operation", () => {
            expect(parse({ confirm: true }).success).toBe(false);
        });

        test("unknown fields", () => {
            expect(
                parse({ operation: "clear", confirm: true, extra: 1 }).success,
            ).toBe(false);
        });

        test("todos is not accepted (clear takes no payload)", () => {
            expect(
                parse({ operation: "clear", confirm: true, todos: [] }).success,
            ).toBe(false);
        });

        test("non-object input", () => {
            expect(parse(null).success).toBe(false);
            expect(parse("clear").success).toBe(false);
            expect(parse(undefined).success).toBe(false);
        });
    });
});

describe("TodoInputToolSchema (clear routing)", () => {
    test("routes operation clear to the clear schema", () => {
        const r = TodoInputToolSchema.safeParse({
            operation: "clear",
            confirm: true,
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.operation).toBe("clear");
    });

    test("clear without confirm is rejected at the union", () => {
        expect(TodoInputToolSchema.safeParse({ operation: "clear" }).success).toBe(
            false,
        );
    });

    test("the old write [] form no longer exists", () => {
        expect(
            TodoInputToolSchema.safeParse({ operation: "write", todos: [] }).success,
        ).toBe(false);
    });

    test("create with an empty list is rejected (clear is the only way to empty)", () => {
        expect(
            TodoInputToolSchema.safeParse({ operation: "create", todos: [] }).success,
        ).toBe(false);
        expect(
            TodoInputToolSchema.safeParse({ operation: "create", todos: "[]" })
                .success,
        ).toBe(false);
    });
});
