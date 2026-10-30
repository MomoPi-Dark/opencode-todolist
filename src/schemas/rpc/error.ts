import z from "zod";
import type { TodoRootItem } from "../todo/item";

export const TodoRuleCodeSchema = z.enum([
    "not_found",
    "list_final",
    "root_out_of_order",
    "item_final",
    "backward_transition",
    "root_busy",
    "child_busy",
    "child_open",
    "cancel_remaining_status",
    "list_invalid",
]);

export const TodoSystemCodeSchema = z.enum([
    "invalid_session",
    "invalid_input",
    "storage_error",
    "internal_error",
]);

export const TodoOperationCodeSchema = z.union([
    TodoRuleCodeSchema,
    TodoSystemCodeSchema,
    z.literal("list_open"),
    z.literal("invalid_list"),
    z.literal("list_empty"),
    z.literal("clear_cancelled"),
]);

export type TodoOperationCode = z.infer<typeof TodoOperationCodeSchema>;

/**
 * The domain-facing name for the rule subset. Derived, never redeclared, so a
 * rule added here is automatically valid in `TodoOperationCodeSchema` too.
 */
export type TodoRuleCode = z.infer<typeof TodoRuleCodeSchema>;

export const TodoOperationErrorSchema = z.object({
    code: TodoOperationCodeSchema,
    message: z.string(),
    index: z.number().int().nonnegative().optional(),
});

export type TodoOperationError = z.infer<typeof TodoOperationErrorSchema>;

export interface TodoOperationOk {
    ok: true;
    /** Text handed back to the model. */
    content: string;
    /** The list as it now stands; this is what gets stored. */
    todos: TodoRootItem[];
}

export interface TodoOperationErr {
    ok: false;
    /** The list unchanged, so a refused call can never lose stored work. */
    todos: TodoRootItem[];
    /**
     * The single source of truth for a refusal: code, actionable message for the
     * model, and the offending index when there is one. It is not duplicated at
     * the top level, so there is exactly one place to read a failure from.
     */
    error: TodoOperationError;
}

export type TodoOperationResult = TodoOperationOk | TodoOperationErr;

export type TodoToolResult = {
    output: { todos: TodoRootItem[] };
    content: string;
    metadata?: { code?: TodoOperationCode; visibleIds?: readonly number[] };
};

export class TodoToolRejection extends Error {
    readonly code: TodoOperationCode | undefined;

    constructor(error: TodoOperationError | undefined) {
        super(error?.message ?? "The operation was rejected.");
        this.name = "TodoToolRejection";
        this.code = error?.code;
    }

    /**
     * `Error#message` is non-enumerable, so plain `JSON.stringify` dropped it and
     * the host rendered the whole object as `[object Object]`. This keeps the
     * message in the payload that actually reaches the model.
     */
    toJSON(): { name: string; message: string; code?: TodoOperationCode } {
        return {
            name: this.name,
            message: this.message,
            ...(this.code === undefined ? {} : { code: this.code }),
        };
    }
}

export const toToolResult = (result: {
    ok: boolean;
    todos: TodoRootItem[];
    content?: string;
    visibleIds?: readonly number[];
    error?: TodoOperationError;
}): TodoToolResult => {
    if (!result.ok) throw new TodoToolRejection(result.error);

    return {
        output: { todos: result.todos },
        content: result.content ?? "",
        ...(result.visibleIds === undefined
            ? {}
            : { metadata: { visibleIds: result.visibleIds } }),
    };
};

export const operationOk = (
    todos: TodoRootItem[],
    content: string,
): TodoOperationOk => ({ ok: true, content, todos });

export const operationErr = (error: {
    code: TodoOperationCode;
    message: string;
    todos: TodoRootItem[];
    index?: number;
}): TodoOperationErr => ({
    ok: false,
    error,
    todos: error.todos,
});

export class OperationRejected extends Error {
    constructor(readonly result: TodoOperationResult) {
        super(result.ok ? "Operation rejected" : result.error.message);
        this.name = "OperationRejected";
    }

    /** Same reason as `TodoToolRejection`: keep `message` on the wire. */
    toJSON(): { name: string; message: string } {
        return { name: this.name, message: this.message };
    }
}
