import {
    OperationRejected,
    operationErr,
    operationOk,
    type TodoOperationResult,
} from "../../schemas/rpc/error";
import type { TodoList } from "../../schemas/todo/item";
import type { TodoUpdateInput, TodoUpdateItem } from "../../schemas/todo/update";
import { updateTodos } from "../../storage/todo-store";
import { TodoRules } from "../security/rules";
import { formatWriteOutput } from "../utils/formatText";
import { emitChanged, type TodoSessionRpc } from "./session-rpc";

/**
 * `update`: apply a validated batch, in order, atomically.
 *
 * Every step is checked against the state left by the previous one, so a batch
 * may finish one item and start the next in a single call.
 */
export function applyUpdate(
    todos: TodoList,
    updates: readonly TodoUpdateItem[],
): TodoOperationResult {
    const applied = TodoRules.apply(todos, updates);
    if (!applied.ok) {
        const { error, index } = applied;
        return operationErr(
            error.code,
            `Update ${index + 1} of ${updates.length} (id ${error.id ?? "?"}) rejected: ${error.message}`,
            [...todos],
            index,
        );
    }

    return operationOk(
        applied.todos,
        formatWriteOutput(applied.todos, [...todos]),
    );
}

/**
 * Applies `update` to the stored list of a session.
 *
 * `rpc` is optional so the pure write path (and tests) can run without an RPC
 * registration; when present, a committed write emits `changed`.
 */
export async function updateSessionTodos(
    sessionID: string,
    input: Pick<TodoUpdateInput, "updates">,
    rpc?: TodoSessionRpc,
): Promise<TodoOperationResult> {
    let accepted: TodoOperationResult | undefined;

    try {
        await updateTodos(sessionID, (current) => {
            const result = applyUpdate(current, input.updates);
            if (!result.ok) throw new OperationRejected(result);
            accepted = result;
            return result.todos;
        });
    } catch (error) {
        if (error instanceof OperationRejected) return error.result;
        throw error;
    }

    if (!accepted) return operationErr("not_found", "Nothing updated.", []);

    if (rpc) await emitChanged(rpc, sessionID);
    return accepted;
}

/** Session-level name kept for callers that pass the full operation input. */
export const handleUpdate = (
    sessionID: string,
    input: TodoUpdateInput,
    rpc?: TodoSessionRpc,
) => updateSessionTodos(sessionID, input, rpc);
