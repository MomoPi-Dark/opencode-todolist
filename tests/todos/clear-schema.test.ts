import { describe, expect, test } from "bun:test";
import { TodoRpcClearInputSchema } from "../../src/schemas/rpc/input";

const parse = (input: Record<string, unknown>) =>
    TodoRpcClearInputSchema.safeParse({ sessionID: "ses_1", ...input });

describe("TodoRpcClearInputSchema", () => {
    test("accepts force alone, and drops confirm from that branch", () => {
        const result = parse({ force: true });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual({ sessionID: "ses_1", force: true });
        }
    });

    test("accepts confirm alone, and normalises force to false", () => {
        const result = parse({ confirm: true });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual({
                sessionID: "ses_1",
                confirm: true,
                force: false,
            });
        }
    });

    test("rejects force together with confirm", () => {
        expect(parse({ force: true, confirm: true }).success).toBe(false);
    });

    test("rejects force together with confirm even when confirm is false", () => {
        expect(parse({ force: true, confirm: false }).success).toBe(false);
    });

    test("rejects neither field", () => {
        const result = parse({});
        expect(result.success).toBe(false);
    });

    test("rejects confirm: false", () => {
        expect(parse({ confirm: false }).success).toBe(false);
    });

    test("rejects force: false without confirm", () => {
        expect(parse({ force: false }).success).toBe(false);
    });

    test("accepts force: false with confirm: true", () => {
        expect(parse({ force: false, confirm: true }).success).toBe(true);
    });

    test("rejects unknown keys in either branch", () => {
        expect(parse({ force: true, extra: 1 }).success).toBe(false);
        expect(parse({ confirm: true, extra: 1 }).success).toBe(false);
    });
});
