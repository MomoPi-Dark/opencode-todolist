import {
    OperationRejected,
    operationErr,
    operationOk,
    type TodoOperationResult,
} from "../../schemas/rpc/error";
import {
    TodoRpcClearInput,
    TodoRpcClearInputGuard,
} from "../../schemas/rpc/input";
import type { TodoList } from "../../schemas/todo/item";
import { updateTodos } from "../../storage/todo-store";
import { refuseIfOpen } from "../security/openguard";
import { plural } from "../utils/plural";
import { emitChanged, type TodoSessionRpc } from "./session-rpc";

/**
 * `clear`: drop the whole list.
 *
 * `confirm: true` is enforced by the schema, so by the time this runs the caller
 * has said yes on purpose. The open-list guard applies unless `force` is set.
 * Clearing an empty list succeeds, so the call is idempotent.
 */
export function handleClear(
    todos: TodoList,
    input: TodoRpcClearInput,
): TodoOperationResult {
    if (input.guard === "guard") {
        const refused = refuseIfOpen("clear", todos);
        if (refused) return refused;
    }

    if (todos.length === 0) {
        return operationOk([], "The list was already empty.");
    }

    const subtasks = todos.reduce(
        (count, root) => count + (root.children?.length ?? 0),
        0,
    );

    const removed =
        subtasks > 0
            ? `${plural(todos.length, "todo")} and ${plural(subtasks, "subtask")}`
            : plural(todos.length, "todo");

    return operationOk([], `Cleared ${removed}.`);
}

export async function clearSessionTodos(
    sessionID: string,
    options: { guard: TodoRpcClearInputGuard; rpc?: TodoSessionRpc },
): Promise<TodoOperationResult> {
    let accepted: TodoOperationResult | undefined;

    try {
        await updateTodos(sessionID, (current) => {
            const result = handleClear(current, { guard: options.guard, sessionID });
            if (!result.ok) throw new OperationRejected(result);
            accepted = result;
            return result.todos;
        });
    } catch (error) {
        if (error instanceof OperationRejected) return error.result;
        throw error;
    }

    if (!accepted)
        return operationErr({
            code: "not_found",
            message: "Nothing cleared.",
            todos: [],
        });
    if (options.rpc) await emitChanged(options.rpc, sessionID);

    return accepted;
}
