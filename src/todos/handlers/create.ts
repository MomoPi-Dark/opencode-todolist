import type { TodoCreateOperationInput } from "../../schemas/todo/create";
import type { TodoList, TodoRootItem } from "../../schemas/todo/item";
import { TodoTree } from "../todo-tree";
import { formatWriteOutput } from "./formatText";
import {
    operationErr,
    operationOk,
    type TodoOperationResult,
} from "./types";

/**
 * `create`: replace the whole list with a new plan.
 *
 * Refused while anything is still open. A plan is only "finished" when every row
 * is `completed` or `cancelled`, and silently overwriting a half-done plan loses
 * the evidence trail in each row's note. The model has to close the old plan
 * first, which also keeps the TUI honest about what happened.
 *
 * The new list is validated before it is accepted: `create` is the one operation
 * that can introduce a structurally wrong list (duplicate ids, bad subtask
 * prefixes, two roots running at once), so the same validator every other path
 * uses runs here too.
 */
export function handleCreate(
    todos: TodoList,
    input: TodoCreateOperationInput,
): TodoOperationResult {
    if (TodoTree.hasOpen(todos)) {
        const open = TodoTree.openLeaves(todos);
        const now = open[0];
        return operationErr(
            "list_open",
            `Cannot create a new list: ${open.length} todo${open.length === 1 ? " is" : "s are"} still open${now ? ` (currently ${now.id} ${now.content})` : ""
            }. Finish or cancel ${open.length === 1 ? "it" : "them"} first.`,
            [...todos],
        );
    }

    const check = TodoTree.validateAndNormalize(input.todos);
    if (!check.valid) {
        return operationErr("invalid_list", check.error, [...todos]);
    }

    const next: TodoRootItem[] = check.data;
    return operationOk(next, formatWriteOutput(next, todos));
}
