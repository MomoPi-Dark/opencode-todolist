import { describe, expect, test } from "bun:test";
import { TodoInputToolSchema } from "../../src/schemas/todo";
import { TodoClearOperationSchema } from "../../src/schemas/todo/clear";

const parse = (input: unknown) => TodoClearOperationSchema.safeParse(input);

describe("TodoClearOperationSchema", () => {
    describe("accepts", () => {
        test("a bare clear operation", () => {
            const r = parse({ operation: "clear" });
            expect(r.success).toBe(true);
            if (r.success) expect(r.data).toEqual({ operation: "clear" });
        });
    });

    describe("rejects: shape", () => {
        test("wrong operation", () => {
            expect(parse({ operation: "create" }).success).toBe(false);
            expect(parse({ operation: "write" }).success).toBe(false);
        });

        test("missing operation", () => {
            expect(parse({}).success).toBe(false);
        });

        test("unknown fields", () => {
            expect(parse({ operation: "clear", extra: 1 }).success).toBe(false);
        });

        test("todos is not accepted (clear takes no payload)", () => {
            expect(parse({ operation: "clear", todos: [] }).success).toBe(false);
        });

        test("a leftover confirm flag is rejected", () => {
            // The tool-level confirmation is gone: the agent asks the user in
            // chat, and `ui.confirm` belongs to the panel RPC only.
            expect(parse({ operation: "clear", confirm: true }).success).toBe(
                false,
            );
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
        const r = TodoInputToolSchema.safeParse({ operation: "clear" });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.operation).toBe("clear");
    });

    test("the old write [] form no longer exists", () => {
        expect(
            TodoInputToolSchema.safeParse({ operation: "write", todos: [] })
                .success,
        ).toBe(false);
    });

    test("create with an empty list is rejected (clear is the only way to empty)", () => {
        expect(
            TodoInputToolSchema.safeParse({ operation: "create", todos: [] })
                .success,
        ).toBe(false);
        expect(
            TodoInputToolSchema.safeParse({ operation: "create", todos: "[]" })
                .success,
        ).toBe(false);
    });
});
