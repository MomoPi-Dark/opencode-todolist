import { describe, expect, test } from "bun:test";
import type { TodoOperationResult } from "../../src/schemas/rpc/error";
import { handleClear } from "../../src/todos/handlers/clear";
import { handleRead } from "../../src/todos/handlers/read";
import { applyUpdate } from "../../src/todos/handlers/update";

/**
 * A wrong operation is an error, never a reply.
 *
 * Every handler answers a mistake with `ok: false`, so the tool layer throws and
 * the model sees a failed call instead of a success carrying an apology.
 */
const expectError = (
    result: TodoOperationResult,
    code: Extract<TodoOperationResult, { ok: false }>["error"]["code"],
) => {
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
};

describe("CRUD reports mistakes as errors", () => {
    describe("read", () => {
        test("an empty list still answers, by design", () => {
            // The `list_empty` guard is intentionally parked for `read`: an
            // empty session is a valid answer to "what is in the list?".
            const result = handleRead([], {
                operation: "read",
                format: "tree",
                scope: "all",
            });
            expect(result.ok).toBe(true);
        });
    });

    describe("clear", () => {
        test("an empty list is an error under either guard", () => {
            expectError(
                handleClear([], { sessionID: "ses_1", guard: "stand" }),
                "list_empty",
            );
            expectError(
                handleClear([], { sessionID: "ses_1", guard: "disable" }),
                "list_empty",
            );
        });
    });

    describe("update", () => {
        test("an empty list is an error, not a per-id not_found", () => {
            expectError(
                applyUpdate([], [{ id: 1, status: "pending" }]),
                "list_empty",
            );
        });

        test("an unknown id still reports not_found", () => {
            expectError(
                applyUpdate(
                    [{ id: 1, content: "A", status: "pending" }],
                    [{ id: 99, status: "completed" }],
                ),
                "not_found",
            );
        });
    });
});
