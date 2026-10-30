import { operationErr, operationOk } from "../../schemas/rpc/error";
import { type TodoReadResult } from "../../schemas/rpc/read";
import type { TodoList, TodoRootItem } from "../../schemas/todo/item";
import type { TodoReadInput } from "../../schemas/todo/read";
import { readTodos } from "../../storage/todo-store";
import { TodoLocation, TodoTree } from "../todotree";

const resolveTarget = (todos: TodoList, target: number): TodoLocation | null =>
    TodoTree.find(todos, target);

/** The read contract lives in the schema; this is only its readable name. */
export type ReadToolResult = TodoReadResult;

const notFound = (todos: TodoList, message: string): ReadToolResult => ({
    ...operationErr({
        code: "not_found",
        message,
        todos: [...todos],
    }),
});

export function handleRead(
    todos: TodoList,
    input: TodoReadInput,
): ReadToolResult {
    let scoped: TodoRootItem[] = [...todos];
    let visibleIds: readonly number[] | undefined;

    if (
        input.scope === "root" ||
        input.scope === "item" ||
        input.scope === "children"
    ) {
        const found = resolveTarget(todos, input.target);
        if (!found) {
            return notFound(todos, `No todo ${input.target}.`);
        }

        scoped = [found.root];

        if (input.scope === "item") {
            visibleIds = [found.item.id];
        } else if (input.scope === "children") {
            if (found.depth === 0) {
                return notFound(todos, `No child todo ${input.target}.`);
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
        ...operationOk(scoped, content),
        ...(visibleIds === undefined ? {} : { visibleIds }),
    };
}

export async function readSessionTodos(
    sessionID: string,
    input: TodoReadInput,
): Promise<ReadToolResult> {
    const todos = await readTodos(sessionID);
    return handleRead(todos, input);
}
