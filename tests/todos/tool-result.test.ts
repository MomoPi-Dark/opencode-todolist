import { describe, expect, test } from "bun:test";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { handleClear } from "../../src/todos/handlers/clear";
import { handleCreate } from "../../src/todos/handlers/create";
import { toToolResult, type TodoOperationResult } from "../../src/schemas/rpc/error";

const todos: TodoRootItem[] = [
    { id: 1, content: "Task", status: "pending" },
];

describe("toToolResult", () => {
    test("converts refused handler results to a valid tool result", () => {
        const result: TodoOperationResult = {
            ok: false,
            todos,
            error: {
                code: "list_open",
                message: "Finish the current todo first.",
            },
        };

        expect(toToolResult(result)).toEqual({
            output: { todos },
            content: "Finish the current todo first.",
            metadata: { code: "list_open" },
        });
    });

    test("handlers return tool results without an index adapter", () => {
        expect(toToolResult(handleClear([{ id: 1, content: "Task", status: "completed" }]))).toEqual({
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
