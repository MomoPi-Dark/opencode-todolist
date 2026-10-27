import type { TodoRootItem } from "../../schemas/todo/item";
import type { TodoRuleCode } from "../rules";

/**
 * Every reason an operation can be refused.
 *
 * `TodoRuleCode` covers the per-row update rules; the extra members are
 * operation-level refusals that have nothing to do with a single row.
 */
export type TodoOperationCode = TodoRuleCode | "list_open" | "invalid_list";

export interface TodoOperationOk {
    ok: true;
    /** Text handed back to the model. */
    content: string;
    /** The list as it now stands; this is what gets stored. */
    todos: TodoRootItem[];
}

export interface TodoOperationErr {
    ok: false;
    code: TodoOperationCode;
    /** Actionable message for the model; the same text `content` would carry. */
    message: string;
    /** The list unchanged, so a refused call can never lose stored work. */
    todos: TodoRootItem[];
}

export type TodoOperationResult = TodoOperationOk | TodoOperationErr;
export type TodoToolResult = {
    output: { todos: TodoRootItem[] };
    content: string;
    metadata?: { code?: TodoOperationCode; visibleIds?: readonly number[] };
};

export const toToolResult = (result: {
    ok: boolean;
    todos: TodoRootItem[];
    content?: string;
    message?: string;
    code?: TodoOperationCode;
    visibleIds?: readonly number[];
}): TodoToolResult => {
    return result.ok
        ? {
              output: { todos: result.todos },
              content: result.content ?? "",
              ...(result.visibleIds === undefined
                  ? {}
                  : { metadata: { visibleIds: result.visibleIds } }),
          }
        : {
              output: { todos: result.todos },
              content: result.message ?? result.content ?? "",
              metadata: { code: result.code },
          };
};

export const operationOk = (
    todos: TodoRootItem[],
    content: string,
): TodoOperationOk => ({ ok: true, content, todos });

export const operationErr = (
    code: TodoOperationCode,
    message: string,
    todos: TodoRootItem[],
): TodoOperationErr => ({ ok: false, code, message, todos });
