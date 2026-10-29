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

/**
 * Clearing a session's list.
 *
 * The two ways in are mutually exclusive, and the schema says so in its type:
 * - `force: true` — the GUI and TUI, where the user confirmed through a dialog
 *   they see. `confirm` is not part of this branch, so it cannot be sent twice.
 * - otherwise `confirm: true` is required, so a caller that forgot to ask cannot
 *   clear silently.
 *
 * A discriminated union needs its key to be present, so `force` is defaulted to
 * `false` before the union is applied: the tool sends no `force` at all.
 *
 * `force` lives here and not in `TodoClearOperationSchema`: the tool schema is
 * sent to the model on every request, and a model must keep the open guard.
 */
export const TodoRpcClearInputSchema = z.preprocess(
    (val) =>
        val && typeof val === "object" && !("force" in val)
            ? { ...val, force: false }
            : val,
    z.discriminatedUnion("force", [
        SessionIdSchema.extend({
            force: z.literal(true),
        }).strict(),
        SessionIdSchema.extend({
            force: z.literal(false),
            confirm: z.literal(true, {
                error: "Pass confirm: true, or force: true from the GUI or TUI",
            }),
        }).strict(),
    ]),
);
export type TodoRpcClearInput = z.infer<typeof TodoRpcClearInputSchema>;
