import { Plugin } from "@opencode/plugin";
import { Todos } from "./rpc";
import { TodoInputToolSchema, TodoOutputToolSchema } from "./schemas/todo";
import { registerTodoSkills } from "./skills/loader";
import {
    clearSessionTodos,
    createSessionTodos,
    readSessionTodos,
    runOperation,
    updateSessionTodos,
} from "./todos/handlers";
import type { TodoSessionRpc } from "./todos/handlers/session-rpc";
import { registerTodoPromptHook } from "./todos/utils/hint";

/**
 * Registers the todo RPC.
 *
 * The handlers need the registration to emit `changed`, but the registration
 * does not exist until `register` resolves. A mutable holder is initialised in
 * the same tick, and the handlers only run after this function returns, so the
 * holder is always populated by the time it is read — no cast, no fake context.
 */
async function registerTodoRpc(ctx: Plugin.Context) {
    const holder: { rpc?: TodoSessionRpc } = {};

    const registration = await ctx.rpc.register(Todos, {
        // The session handlers own emission: a handler that mutates the list
        // emits `changed` itself once the write is committed.
        read: (input) => readSessionTodos(input.sessionID, input),
        create: (input) => {
            if (!holder.rpc) throw new Error("todo rpc not ready");
            return createSessionTodos(input.sessionID, input, holder.rpc);
        },
        update: (input) => {
            if (!holder.rpc) throw new Error("todo rpc not ready");
            return updateSessionTodos(input.sessionID, input, holder.rpc);
        },
        clear: (input) => {
            if (!holder.rpc) throw new Error("todo rpc not ready");
            return clearSessionTodos(input.sessionID, holder.rpc);
        },
    });

    holder.rpc = registration;
    return registration;
}

export default Plugin.define({
    id: "todolist.tool",
    async setup(ctx) {
        const rpc = ctx.rpc(Todos);

        await registerTodoRpc(ctx);
        await registerTodoSkills(ctx);
        await registerTodoPromptHook(ctx);

        await ctx.tool.transform((tools) => {
            tools.add({
                name: "manage_todo_list",
                description:
                    "Track multi-step work (3+ steps) in a hierarchical todo list. Operations: read, create, update, clear. Supports status, priority, notes, and subtasks; read first when unsure of the current state.",
                input: TodoInputToolSchema,
                output: TodoOutputToolSchema,
                options: { codemode: false },
                execute: async (input, toolContext) => {
                    const parsed = TodoInputToolSchema.safeParse(input);
                    if (!parsed.success) {
                        throw new Error(
                            `Invalid manage_todo_list input: ${parsed.error.issues
                                .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
                                .join(", ")}`,
                        );
                    }
                    const { sessionID } = toolContext;
                    return runOperation(rpc, parsed.data, sessionID);
                },
            });
        });
    },
});
