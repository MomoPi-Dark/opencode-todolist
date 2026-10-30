import z from "zod";
import { TodoListSchema } from "../todo/item";
import { TodoOperationErrorSchema } from "./error";

/**
 * Ids the model is allowed to see. A read scopes its *rendering* by these, so
 * they belong in the result contract, not only in the renderer's options.
 */
export const VisibleIdsSchema = z
    .array(z.number().int())
    .readonly()
    .describe(
        "Ids the read is scoped to, newest first; omitted means every row.",
    );

const readFields = {
    todos: TodoListSchema,
    visibleIds: VisibleIdsSchema.optional(),
};

/**
 * A read always renders a text body, so `content` is required on success. The
 * failure branch deliberately has no `content`: its text is `error.message`, and
 * keeping one copy is what makes the schema the single source of truth.
 */
export const TodoReadSuccessSchema = z.object({
    ok: z.literal(true),
    ...readFields,
    content: z.string(),
});

export const TodoReadErrorSchema = z.object({
    ok: z.literal(false),
    ...readFields,
    error: TodoOperationErrorSchema,
});

export const TodoReadResultSchema = z.discriminatedUnion("ok", [
    TodoReadSuccessSchema,
    TodoReadErrorSchema,
]);
export type TodoReadResult = z.infer<typeof TodoReadResultSchema>;
