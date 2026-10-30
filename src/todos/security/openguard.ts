import { operationErr, TodoOperationResult } from "../../schemas/rpc/error";
import { TodoList } from "../../schemas/todo/item";
import { TodoTree } from "../todotree";
import { plural } from "../utils/plural";

const MAX_LISTED = 3;
const MAX_CONTENT_SHOWN = 60;

const clip = (text: string): string =>
    text.length > MAX_CONTENT_SHOWN
        ? `${text.slice(0, MAX_CONTENT_SHOWN - 1)}…`
        : text;

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
    const target = open.length === 1 ? "it" : "each one";

    const messageError =
        `Cannot ${action}: ${plural(open.length, "todo")} still open (${shown}${more}). ` +
        `Use "update" to set ${target} to completed or cancelled first.`;

    return operationErr({
        code: "list_open",
        message: messageError,
        todos: [...todos],
    });
}
