import z from "zod";
import { TodoListSchema } from "../todo/item";
import { TodoReadOperationSchema } from "../todo/read";
import { MAX_UPDATES, TodoUpdateItemSchema } from "../todo/update";

export const SessionIdSchema = z.object({ sessionID: z.string() });

export const TodoRpcReadInputSchema = SessionIdSchema.and(
    z.preprocess(
        (val) =>
            val && typeof val === "object" && !("operation" in val)
                ? { ...val, operation: "read" }
                : val,
        TodoReadOperationSchema,
    ),
);
export type TodoRpcReadInput = z.infer<typeof TodoRpcReadInputSchema>;

export const TodoRpcCreateInputSchema = SessionIdSchema.extend({
    todos: TodoListSchema,
});
export type TodoRpcCreateInput = z.infer<typeof TodoRpcCreateInputSchema>;

export const TodoRpcUpdateInputSchema = SessionIdSchema.extend({
    updates: z.array(TodoUpdateItemSchema).min(1).max(MAX_UPDATES),
});
export type TodoRpcUpdateInput = z.infer<typeof TodoRpcUpdateInputSchema>;

export const TodoRpcClearInputSchema = SessionIdSchema.extend({
    confirm: z.boolean().optional(),
    /**
     * Skips the "list still has open todos" guard. Set by the GUI and TUI, where
     * the user confirmed through a dialog they see. Not part of the tool schema:
     * the tool schema is sent on every request, and a model must keep the guard.
     */
    force: z.boolean().optional(),
});
export type TodoRpcClearInput = z.infer<typeof TodoRpcClearInputSchema>;
