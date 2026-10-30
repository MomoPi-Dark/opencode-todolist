import { describe, expect, test } from "bun:test";
import { TodoRpcClearInputSchema } from "../../src/schemas/rpc/input";

const parse = (input: Record<string, unknown>) =>
    TodoRpcClearInputSchema.safeParse({ sessionID: "ses_1", ...input });

describe("TodoRpcClearInputSchema", () => {
    test("accepts the guard on", () => {
        const result = parse({ guard: "stand" });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual({ sessionID: "ses_1", guard: "stand" });
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
        expect(parse({ guard: "stand", force: true }).success).toBe(false);
        expect(parse({ guard: "stand", confirm: true }).success).toBe(false);
    });

    test("accepts the dialog answer under ui", () => {
        const result = parse({ guard: "disable", ui: { confirm: true } });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual({
                sessionID: "ses_1",
                guard: "disable",
                ui: { confirm: true },
            });
        }
    });

    test("accepts custom dialog messages", () => {
        const result = parse({
            guard: "disable",
            ui: {
                confirm: false,
                accept_message: "Clear it",
                cancel_message: "Keep it",
            },
        });

        expect(result.success).toBe(true);
    });

    test("ui.confirm is required when ui is present", () => {
        expect(parse({ guard: "disable", ui: {} }).success).toBe(false);
        expect(
            parse({ guard: "disable", ui: { accept_message: "x" } }).success,
        ).toBe(false);
    });

    test("ui rejects unknown keys", () => {
        expect(
            parse({ guard: "disable", ui: { confirm: true, force: true } })
                .success,
        ).toBe(false);
    });
});
