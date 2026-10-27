import type { TodoList, TodoRootItem } from "../../schemas/todo/item";
import type { TodoReadInput } from "../../schemas/todo/read";
import { TodoTree, type TodoLocation } from "../todo-tree";
import { type TodoOperationResult } from "./types";

/**
 * `read` answers with an extra field: which row ids were printed. The caller can
 * pass that on to the TUI to highlight the row that was just inspected, without
 * re-deriving the scope.
 */
export type ReadOperationResult = TodoOperationResult & {
    visibleIds?: readonly number[];
};

/**
 * Resolves the `target` of a scoped read.
 *
 * `scope: "root"` and `scope: "item"` both end up as a `TodoLocation`, so the
 * renderer has only one shape to know. Targeting a root with `scope: "item"` is
 * legal too — it shows that single root.
 */
const resolveTarget = (todos: TodoList, target: number): TodoLocation | null =>
    TodoTree.find(todos, target);

/** What the tool returns for `read`; the same shape `execute` hands to the host. */
export interface ReadToolResult {
    ok: boolean;
    todos: TodoRootItem[];
    content: string;
    visibleIds?: readonly number[];
}

/**
 * `read`: render the stored list, optionally narrowed to one root or one row.
 * `children` shows the selected child with its root as context.
 *
 * Read never refuses because the list is "malformed" — showing the rows is more
 * useful than hiding them — but the structural warning goes first so the model
 * repairs the list before trusting the shape. It *does* refuse an unknown
 * `target`, because silently returning the whole list would hide the mistake.
 *
 * `metadata.visibleIds` tells the TUI which rows were printed. It is omitted
 * when everything is shown.
 */
export function handleRead(
    todos: TodoList,
    input: TodoReadInput,
): ReadToolResult {
    if (todos.length === 0) {
        return { ok: true, todos: [], content: "No todos recorded." };
    }

    let scoped: TodoRootItem[] = [...todos];
    let visibleIds: readonly number[] | undefined;

    if (input.scope === "root" || input.scope === "item" || input.scope === "children") {
        const found = resolveTarget(todos, input.target);
        if (!found) {
            return {
                ok: false,
                todos: [...todos],
                content: `No todo ${input.target}.`,
            };
        }

        // The root keeps *all* its subtasks so its (completed/total) label stays
        // honest; only the printed rows are narrowed. Dropping the subtasks
        // would silently turn (2/2) into (1/1).
        scoped = [found.root];

        if (input.scope === "item") {
            visibleIds =
                found.depth === 0
                    ? // A root targeted as an item is that one row; its subtasks belong
                    // to `scope: "root"`.
                    [found.root.id]
                    : // A subtask alone would print as an indented row with no parent, so
                    // the root line comes along as context. Its progress label is the
                    // real one, because the subtasks are still in `scoped`.
                    [found.root.id, found.item.id];
        } else if (input.scope === "children") {
            if (found.depth === 0) {
                return {
                    ok: false,
                    todos: [...todos],
                    content: `No child todo ${input.target}.`,
                };
            }
            visibleIds = [found.root.id, found.item.id];
        }
    }

    const body =
        input.format === "summary"
            ? TodoTree.renderSummary(scoped, { visibleIds })
            : TodoTree.render(scoped, { visibleIds });

    const check = TodoTree.validateAndNormalize(todos);
    const content = check.valid
        ? body
        : `Warning: the stored list needs fixing — ${check.error}\n${body}`;

    return {
        ok: true,
        todos: scoped,
        content,
        ...(visibleIds === undefined ? {} : { visibleIds }),
    };
}
