import { describe, expect, test } from "bun:test";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { handleClear } from "../../src/todos/handlers/clear";
import { handleCreate } from "../../src/todos/handlers/create";
import { toToolResult, TodoToolRejection, type TodoOperationResult } from "../../src/schemas/rpc/error";

const todos: TodoRootItem[] = [
    { id: 1, content: "Task", status: "pending" },
];

describe("toToolResult", () => {
    test("a refusal throws instead of returning a reply", () => {
        // A rejected guard must not look like a success to the model.
        const result: TodoOperationResult = {
            ok: false,
            todos,
            error: {
                code: "list_open",
                message: "Finish the current todo first.",
            },
        };

        expect(() => toToolResult(result)).toThrow(
            "Finish the current todo first.",
        );
    });

    test("the thrown rejection carries the error code", () => {
        try {
            toToolResult({
                ok: false,
                todos,
                error: { code: "list_open", message: "nope" },
            });
            throw new Error("expected a rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(TodoToolRejection);
            expect((error as TodoToolRejection).code).toBe("list_open");
        }
    });

    test("handlers return tool results without an index adapter", () => {
        expect(toToolResult(handleClear([{ id: 1, content: "Task", status: "completed" }], { guard: "stand", sessionID: "ses_1" }))).toEqual({
            output: { todos: [] },
            content: "Cleared 1 todo.",
        });

        expect(
            toToolResult(handleCreate([], {
                operation: "create",
                todos: [{ id: 1, content: "Task", status: "pending" }],
            })),
        ).toEqual({
            output: { todos: [{ id: 1, content: "Task", status: "pending" }] },
            content: "Todos (0/1).\nNext: 1 Task",
        });
    });
});
