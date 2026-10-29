import { type TodoOperationError } from "../../schemas/rpc/error";
import type { TodoList, TodoRootItem } from "../../schemas/todo/item";
import type { TodoReadInput } from "../../schemas/todo/read";
import { readTodos } from "../../storage/todo-store";
import { TodoLocation, TodoTree } from "../todotree";

const resolveTarget = (todos: TodoList, target: number): TodoLocation | null =>
    TodoTree.find(todos, target);

export type ReadToolResult =
    | {
        ok: true;
        todos: TodoRootItem[];
        content: string;
        visibleIds?: readonly number[];
    }
    | {
        ok: false;
        todos: TodoRootItem[];
        content: string;
        visibleIds?: readonly number[];
        error: TodoOperationError;
    };

export function handleRead(
    todos: TodoList,
    input: TodoReadInput,
): ReadToolResult {
    if (todos.length === 0) {
        return { ok: true, todos: [], content: "No todos recorded." };
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
            return {
                ok: false,
                todos: [...todos],
                content: `No todo ${input.target}.`,
                error: {
                    code: "not_found",
                    message: `No todo ${input.target}.`,
                },
            };
        }

        scoped = [found.root];

        if (input.scope === "item") {
            visibleIds = [found.item.id];
        } else if (input.scope === "children") {
            if (found.depth === 0) {
                return {
                    ok: false,
                    todos: [...todos],
                    content: `No child todo ${input.target}.`,
                    error: {
                        code: "not_found",
                        message: `No child todo ${input.target}.`,
                    },
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

export async function readSessionTodos(
    sessionID: string,
    input: TodoReadInput,
): Promise<ReadToolResult> {
    const todos = await readTodos(sessionID);
    return handleRead(todos, input);
}
