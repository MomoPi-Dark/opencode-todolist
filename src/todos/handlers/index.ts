import { Plugin } from "@opencode/plugin";
import { Todos } from "../../rpc";
import { toToolResult } from "../../schemas/rpc/error";
import { TodoInputTool } from "../../schemas/todo";
import { getMigrationWarning } from "../../storage/todo-store";
import { readSessionTodos } from "./read";

export { clearSessionTodos, handleClear } from "./clear";
export { createSessionTodos, handleCreate } from "./create";
export { handleUpdate, updateSessionTodos } from "./update";
export { handleRead, readSessionTodos, type ReadToolResult } from "./read";
export { emitChanged, type TodoSessionRpc } from "./session-rpc";

type TodoRpcClient = ReturnType<typeof getRpcClient>;
const getRpcClient = (ctx: Plugin.Context) => ctx.rpc(Todos);

export async function runOperation(
    rpc: TodoRpcClient,
    data: TodoInputTool,
    sessionID: string,
) {
    const withMigrationNotice = (result: ReturnType<typeof toToolResult>) => {
        const warning = getMigrationWarning();
        return warning === undefined
            ? result
            : { ...result, content: `${warning}\n\n${result.content}` };
    };

    switch (data.operation) {
        case "read":
            return withMigrationNotice(
                toToolResult(await readSessionTodos(sessionID, data)),
            );

        case "create":
            return withMigrationNotice(
                toToolResult(
                    (await rpc.create({ sessionID, todos: data.todos })) as any,
                ),
            );

        case "update":
            return toToolResult(
                (await rpc.update({ sessionID, updates: data.updates })) as any,
            );

        case "clear":
            return toToolResult(
                (await rpc.clear({ sessionID, confirm: data.confirm })) as any,
            );

        default: {
            // Compile error here means a new operation was added to the schema
            // without a branch in this switch.
            const unreachable: never = data;
            throw new Error(`Unsupported operation: ${JSON.stringify(unreachable)}`);
        }
    }
}
