import {
    operationErr,
    operationOk,
    type TodoOperationResult,
} from "../../schemas/rpc/error";
import type { TodoList, TodoRootItem } from "../../schemas/todo/item";
import type { TodoReadInput } from "../../schemas/todo/read";
import { readTodos } from "../../storage/todo-store";
import { TodoLocation, TodoTree } from "../todotree";

const resolveTarget = (todos: TodoList, target: number): TodoLocation | null =>
    TodoTree.find(todos, target);

/**
 * A read carries the ids the model is allowed to see so the renderer can scope
 * its output, and always carries the text body.
 */
export type ReadToolResult = TodoOperationResult & {
    visibleIds?: readonly number[];
    content?: string;
};

const notFound = (todos: TodoList, message: string): ReadToolResult => ({
    ...operationErr("not_found", message, [...todos]),
    content: message,
});

export function handleRead(
    todos: TodoList,
    input: TodoReadInput,
): ReadToolResult {
    if (todos.length === 0) {
        return operationOk([], "No todos recorded.");
    }

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
