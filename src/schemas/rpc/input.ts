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

export const TodoRpcClearInputGuardSchema = z.enum(["guard", "disable"]);
export type TodoRpcClearInputGuard = z.infer<
    typeof TodoRpcClearInputGuardSchema
>;

export const TodoRpcClearInputSchema = SessionIdSchema.extend({
    guard: TodoRpcClearInputGuardSchema,
}).strict();
export type TodoRpcClearInput = z.infer<typeof TodoRpcClearInputSchema>;
