import type { TodoList } from "../../schemas/todo/item";
import { TodoTree } from "../todo-tree";
import { operationErr, type TodoOperationResult } from "./types";

const MAX_LISTED = 3;
const MAX_CONTENT_SHOWN = 60;

const clip = (text: string): string =>
    text.length > MAX_CONTENT_SHOWN
        ? `${text.slice(0, MAX_CONTENT_SHOWN - 1)}…`
        : text;

/**
 * Shared by `create` and `clear`: a half-done plan has to be closed
 * deliberately, not erased or overwritten.
 *
 * Returns the refusal, or null when nothing is open. `TodoTree.hasOpen` counts
 * subtasks too, so a closed root holding an open subtask still blocks.
 *
 * The message names at most MAX_LISTED items (content clipped), because todo
 * content can be long and this text goes straight into the model's context.
 */
export function refuseIfOpen(
    action: "create" | "clear",
    todos: TodoList,
): TodoOperationResult | null {
    if (!TodoTree.hasOpen(todos)) return null;

    const open = TodoTree.openLeaves(todos);
    const shown = open
        .slice(0, MAX_LISTED)
        .map((item) => `${item.id} "${clip(item.content)}"`)
        .join(", ");
    const more =
        open.length > MAX_LISTED ? `, +${open.length - MAX_LISTED} more` : "";
    const noun = open.length === 1 ? "todo is" : "todos are";
    const target = open.length === 1 ? "it" : "each one";

    return operationErr(
        "list_open",
        `Cannot ${action}: ${open.length} ${noun} still open (${shown}${more}). ` +
        `Use "update" to set ${target} to completed or cancelled first.`,
        [...todos],
    );
}
