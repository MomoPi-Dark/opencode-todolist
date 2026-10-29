import {
    OperationRejected,
    operationErr,
    operationOk,
    type TodoOperationResult,
} from "../../schemas/rpc/error";
import type { TodoClearOperationInput } from "../../schemas/todo/clear";
import type { TodoList } from "../../schemas/todo/item";
import { updateTodos } from "../../storage/todo-store";
import { refuseIfOpen } from "../security/openguard";
import { plural } from "../utils/plural";
import { emitChanged, type TodoSessionRpc } from "./session-rpc";

/**
 * `clear`: drop the whole list.
 *
 * Takes no input: `operation` and `confirm: true` are already enforced by the
 * schema, so by the time this runs the caller has said yes on purpose.
 *
 * Refused while anything is open (see `refuseIfOpen`) unless `force` is set.
 * The flag exists for the GUI and TUI, where the user confirmed through a dialog
 * and owns the data. The tool never sets it, so a model still cannot erase a
 * half-done plan. Clearing an empty list succeeds, so the call is idempotent.
 */
export function handleClear(
    todos: TodoList,
    _input?: TodoClearOperationInput,
    force = false,
): TodoOperationResult {
    if (!force) {
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

/**
 * Clears the stored list of a session.
 *
 * `rpc` is optional so the pure write path (and tests) can run without an RPC
 * registration; when present, a committed write emits `changed`. `force` is
 * passed through from the RPC input.
 */
export async function clearSessionTodos(
    sessionID: string,
    rpc?: TodoSessionRpc,
    force = false,
): Promise<TodoOperationResult> {
    let accepted: TodoOperationResult | undefined;

    try {
        await updateTodos(sessionID, (current) => {
            const result = handleClear(current, undefined, force);
            if (!result.ok) throw new OperationRejected(result);
            accepted = result;
            return result.todos;
        });
    } catch (error) {
        if (error instanceof OperationRejected) return error.result;
        throw error;
    }

    if (!accepted) return operationErr("not_found", "Nothing cleared.", []);

    if (rpc) await emitChanged(rpc, sessionID);
    return accepted;
}
