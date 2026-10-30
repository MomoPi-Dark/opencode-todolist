import { Plugin } from "@opencode/plugin";
import { Todos } from "../../rpc";
import { toToolResult } from "../../schemas/rpc/error";
import { TodoOperationOutputSchema } from "../../schemas/rpc/output";
import { TodoInputTool } from "../../schemas/todo";
import { takeMigrationNotice } from "../../storage/todo-store";
import { readSessionTodos } from "./read";
export { clearSessionTodos, handleClear } from "./clear";
export { createSessionTodos, handleCreate } from "./create";
export { handleRead, readSessionTodos, type ReadToolResult } from "./read";
export { emitChanged, type TodoSessionRpc } from "./session-rpc";
export { handleUpdate, updateSessionTodos } from "./update";

type TodoRpcClient = ReturnType<typeof getRpcClient>;
const getRpcClient = (ctx: Plugin.Context) => ctx.rpc(Todos);

/**
 * The RPC client is untyped at this seam, so every reply is validated against
 * the output schema before it is handed to `toToolResult`.
 */
const parseOutput = (raw: unknown) => TodoOperationOutputSchema.parse(raw);

/**
 * Prepends the one-shot upgrade notice to a tool reply.
 *
 * The notice comes from `takeMigrationNotice()`, which hands it out at most once
 * per process, and it lives here rather than in the RPC layer because only tool
 * replies are read by the model: every character costs context tokens, and the
 * migration outcome cannot change mid-process. The TUI and GUI never see it.
 *
 * The store ranks `failed` above `skipped`, so whichever operation runs first
 * carries the more important message.
 */
const withMigrationNotice = (result: ReturnType<typeof toToolResult>) => {
    const warning = takeMigrationNotice();
    return warning === undefined
        ? result
        : { ...result, content: `${warning}\n\n${result.content}` };
};

export async function runOperation(
    rpc: TodoRpcClient,
    data: TodoInputTool,
    sessionID: string,
) {
    switch (data.operation) {
        case "read":
            return withMigrationNotice(
                toToolResult(await readSessionTodos(sessionID, data)),
            );

        case "create":
            return withMigrationNotice(
                toToolResult(
                    parseOutput(await rpc.create({ sessionID, todos: data.todos })),
                ),
            );

        case "update":
            return withMigrationNotice(
                toToolResult(
                    parseOutput(await rpc.update({ sessionID, updates: data.updates })),
                ),
            );

        case "clear":
            return withMigrationNotice(
                toToolResult(
                    parseOutput(
                        await rpc.clear({
                            sessionID,
                            guard: "stand",
                        }),
                    ),
                ),
            );

        default: {
            const unreachable: never = data;
            throw new Error(`Unsupported operation: ${JSON.stringify(unreachable)}`);
        }
    }
}
