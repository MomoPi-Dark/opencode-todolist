import z from "zod";
import { contentField, noteField } from "./fields";
import { TodoTargetIdSchema } from "./id";
import { isCancellingStatus, PrioritySchema, TodoStatusSchema } from "./status";

/** Max updates per call. Exported so the tool description can reuse it. */
export const MAX_UPDATES = 10;

/**
 * One todo to change inside the required `updates` array.
 * Every field except `id` is optional, but at least one must be present.
 */
export const TodoUpdateItemSchema = z
    .object({
        id: TodoTargetIdSchema,
        status: TodoStatusSchema.optional().describe(
            "New status. Omit to keep the current status.",
        ),
        content: contentField
            .optional()
            .describe("New description. Omit to keep the current one."),
        priority: PrioritySchema.nullable()
            .optional()
            .describe("New priority. Pass null to remove it; omit to keep it."),
        note: noteField
            .nullable()
            .optional()
            .describe("New note. Pass null to remove it; omit to keep it."),
        cancel_remaining: z
            .boolean()
            .optional()
            .describe(
                "If true, cancels the remaining pending subtasks of the target root. Requires status cancelled.",
            ),
    })
    .strict()
    .superRefine((u, ctx) => {
        const changesSomething =
            u.status !== undefined ||
            u.content !== undefined ||
            u.priority !== undefined ||
            u.note !== undefined;

        if (!changesSomething) {
            ctx.addIssue({
                code: "custom",
                message: `Update for ${u.id} changes nothing; provide status, content, priority or note`,
            });
        }

        if (u.cancel_remaining && !(u.status && isCancellingStatus(u.status))) {
            ctx.addIssue({
                code: "custom",
                path: ["cancel_remaining"],
                message: "cancel_remaining requires status cancelled",
            });
        }
    });

/**
 * `updates` requires an array of 1–MAX_UPDATES items, applied in array order
 * inside one transaction.
 *
 * What the schema enforces (cheap, state-free rules, so the model learns about
 * them from the validation error):
 *   - each todo id appears at most once;
 *   - at most one update per call sets `in_progress` (finish the running item,
 *     then start the next one; never start two at once).
 *
 * What the handler enforces (needs the current list):
 *   - every step is valid against the state left by the previous step;
 *   - the whole batch is atomic: if one step fails, nothing is applied.
 *
 */
export const TodoUpdateOperationSchema = z
    .object({
        operation: z
            .literal("update")
            .describe(`'update' up to ${MAX_UPDATES} todos, applied in order.`),
        updates: z
            .array(TodoUpdateItemSchema)
            .min(1)
            .max(MAX_UPDATES, {
                error: `At most ${MAX_UPDATES} updates per call; send the rest in a follow-up call.`,
            })
            .describe(
                `An array of at most ${MAX_UPDATES} updates, applied in order. Each id may appear once.`,
            ),
    })
    .strict()
    .superRefine((op, ctx) => {
        const seen = new Set<number>();
        let inProgressCount = 0;

        op.updates.forEach((u, i) => {
            if (seen.has(u.id)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["updates", i, "id"],
                    message: `Duplicate id ${u.id} in updates; each todo may appear once`,
                });
            }
            seen.add(u.id);

            if (u.status === "in_progress" && ++inProgressCount > 1) {
                ctx.addIssue({
                    code: "custom",
                    path: ["updates", i, "status"],
                    message:
                        "Only one update per call may set status in_progress; start the next item in a follow-up call",
                });
            }
        });
    });

export type TodoUpdateItem = z.infer<typeof TodoUpdateItemSchema>;
/** The validated update batch is always an array. */
export type TodoUpdateBatch = readonly TodoUpdateItem[];
export type TodoUpdateInput = z.infer<typeof TodoUpdateOperationSchema>;

// Pre-parse shape, for callers that build tool input (clients, tests).
export type TodoUpdateItemRaw = z.input<typeof TodoUpdateItemSchema>;
