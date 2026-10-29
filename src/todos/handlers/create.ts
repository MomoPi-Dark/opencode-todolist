import {
    OperationRejected,
    operationErr,
    operationOk,
    type TodoOperationResult,
} from "../../schemas/rpc/error";
import type { TodoCreateOperationInput } from "../../schemas/todo/create";
import type { TodoList, TodoRootItem } from "../../schemas/todo/item";
import { updateTodos } from "../../storage/todo-store";
import { refuseIfOpen } from "../security/openguard";
import { TodoTree } from "../todotree";
import { formatWriteOutput } from "../utils/formatText";
import { emitChanged, type TodoSessionRpc } from "./session-rpc";

/**
 * `create`: replace the whole list with a new plan.
 *
 * Refused while anything is still open, through the same guard `clear` uses, so
 * the refusal wording never diverges between the two operations.
 */
export function handleCreate(
    todos: TodoList,
    input: TodoCreateOperationInput,
): TodoOperationResult {
    const refused = refuseIfOpen("create", todos);
    if (refused) return refused;

    const check = TodoTree.validateAndNormalize(input.todos);
    if (!check.valid) {
        return operationErr("invalid_list", check.error, [...todos]);
    }

    const next: TodoRootItem[] = check.data;
    return operationOk(next, formatWriteOutput(next, todos));
}

/**
 * Applies `create` to the stored list of a session.
 *
 * `rpc` is optional so the pure write path (and tests) can run without an RPC
 * registration; when present, a committed write emits `changed`.
 */
export async function createSessionTodos(
    sessionID: string,
    input: Pick<TodoCreateOperationInput, "todos">,
    rpc?: TodoSessionRpc,
): Promise<TodoOperationResult> {
    let accepted: TodoOperationResult | undefined;

    try {
        await updateTodos(sessionID, (current) => {
            const result = handleCreate(current, {
                operation: "create",
                todos: input.todos,
            });
            if (!result.ok) throw new OperationRejected(result);
            accepted = result;
            return result.todos;
        });
    } catch (error) {
        if (error instanceof OperationRejected) return error.result;
        throw error;
    }

    if (!accepted) return operationErr("invalid_list", "Nothing created.", []);

    if (rpc) await emitChanged(rpc, sessionID);
    return accepted;
}
