import { describe, expect, test } from "bun:test";
import { TodoRpcClearInputSchema } from "../../src/schemas/rpc/input";

const parse = (input: Record<string, unknown>) =>
    TodoRpcClearInputSchema.safeParse({ sessionID: "ses_1", ...input });

describe("TodoRpcClearInputSchema", () => {
    test("accepts force alone", () => {
        const result = parse({ force: true });
        expect(result.success).toBe(true);
    });

    test("accepts confirm alone", () => {
        const result = parse({ confirm: true });
        expect(result.success).toBe(true);
    });

    test("rejects force together with confirm", () => {
        const result = parse({ force: true, confirm: true });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toContain("not both");
        }
    });

    test("rejects force together with confirm even when confirm is false", () => {
        const result = parse({ force: true, confirm: false });
        expect(result.success).toBe(false);
    });

    test("rejects neither field", () => {
        const result = parse({});
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.path).toEqual(["confirm"]);
        }
    });

    test("rejects confirm: false without force", () => {
        expect(parse({ confirm: false }).success).toBe(false);
    });

    test("rejects force: false without confirm", () => {
        expect(parse({ force: false }).success).toBe(false);
    });

    test("accepts force: false with confirm: true", () => {
        expect(parse({ force: false, confirm: true }).success).toBe(true);
    });
});
