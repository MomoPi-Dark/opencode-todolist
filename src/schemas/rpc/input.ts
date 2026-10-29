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
    force: z.boolean().default(false).optional(),
}).superRefine((input, ctx) => {
    if (input.force === true) {
        if (input.confirm !== undefined) {
            ctx.addIssue({
                code: "custom",
                path: ["confirm"],
                message: "Send either force or confirm, not both",
            });
        }
        return;
    }

    if (input.confirm !== true) {
        ctx.addIssue({
            code: "custom",
            path: ["confirm"],
            message: "Pass confirm: true, or force: true from the GUI or TUI",
        });
    }
});
export type TodoRpcClearInput = z.infer<typeof TodoRpcClearInputSchema>;
