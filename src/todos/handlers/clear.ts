import {
    OperationRejected,
    operationErr,
    operationOk,
    type TodoOperationResult,
} from "../../schemas/rpc/error";
import { TodoRpcClearInput } from "../../schemas/rpc/input";
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
    // A dismissed dialog is an explicit refusal: stop before touching anything,
    // so the panel can stay silent instead of reporting a failure.
    if (input.ui && input.ui.confirm === false) {
        return operationErr({
            code: "clear_cancelled",
            message: input.ui.cancel_message ?? "Clear cancelled.",
            todos: [...todos],
        });
    }

    // The user said yes in a dialog, which outranks the agent-facing guard: the
    // guard exists to stop a model from erasing a half-done plan on its own, not
    // to overrule the person who just clicked Clear.
    const confirmedByUser = input.ui?.confirm === true;

    if (input.guard === "stand" && !confirmedByUser) {
        const refused = refuseIfOpen("clear", todos);
        if (refused) return refused;
    }

    if (todos.length === 0) {
        return operationErr({
            code: "list_empty",
            message: "There is no list to clear: this session has no todos.",
            todos: [],
        });
    }

    const subtasks = todos.reduce(
        (count, root) => count + (root.children?.length ?? 0),
        0,
    );

    const removed =
        subtasks > 0
            ? `${plural(todos.length, "todo")} and ${plural(subtasks, "subtask")}`
            : plural(todos.length, "todo");

    // The panel's accept label doubles as the success wording, so the message
    // the user sees matches the button they pressed.
    const prefix = input.ui?.accept_message ?? "Cleared";
    return operationOk([], `${prefix} ${removed}.`);
}

export async function clearSessionTodos(
    sessionID: string,
    options: Omit<TodoRpcClearInput, "sessionID"> & {
        rpc?: TodoSessionRpc;
    },
): Promise<TodoOperationResult> {
    let accepted: TodoOperationResult | undefined;

    try {
        await updateTodos(sessionID, (current) => {
            const result = handleClear(current, {
                guard: options.guard,
                sessionID,
                ui: options.ui,
            });
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
