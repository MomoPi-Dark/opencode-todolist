import { describe, expect, test } from "bun:test";
import { TodoRpcClearInputSchema } from "../../src/schemas/rpc/input";

const parse = (input: Record<string, unknown>) =>
    TodoRpcClearInputSchema.safeParse({ sessionID: "ses_1", ...input });

describe("TodoRpcClearInputSchema", () => {
    test("accepts the guard on", () => {
        const result = parse({ guard: "guard" });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual({ sessionID: "ses_1", guard: "guard" });
        }
    });

    test("accepts the guard disabled", () => {
        const result = parse({ guard: "disable" });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual({
                sessionID: "ses_1",
                guard: "disable",
            });
        }
    });

    test("guard is required", () => {
        expect(parse({}).success).toBe(false);
    });

    test("rejects an unknown guard value", () => {
        expect(parse({ guard: "off" }).success).toBe(false);
        expect(parse({ guard: true }).success).toBe(false);
    });

    test("rejects unknown keys", () => {
        expect(parse({ guard: "guard", force: true }).success).toBe(false);
        expect(parse({ guard: "guard", confirm: true }).success).toBe(false);
    });
});
