import type { TodoList } from "../../schemas/todo/item";
import type { TodoClearOperationInput } from "../../schemas/todo/clear";
import { refuseIfOpen } from "./open-guard";
import { operationOk, type TodoOperationResult } from "./types";

const plural = (n: number, word: string): string =>
    `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * `clear`: drop the whole list.
 *
 * Takes no input: `operation` and `confirm: true` are already enforced by the
 * schema, so by the time this runs the caller has said yes on purpose.
 *
 * Refused while anything is open (see `refuseIfOpen`). Clearing an empty list
 * succeeds, so the call is idempotent.
 */
export function handleClear(
    todos: TodoList,
    _input?: TodoClearOperationInput,
): TodoOperationResult {
    const refused = refuseIfOpen("clear", todos);
    if (refused) return refused;

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
