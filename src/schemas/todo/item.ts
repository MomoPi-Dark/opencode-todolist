import z from "zod";
import { safeParseJson } from "../../utils/parseJson";
import { contentField, MAX_CHILDREN, MAX_ROOTS, noteField } from "./fields";
import { ChildIdSchema, RootIdSchema } from "./id";
import { PrioritySchema, TodoStatusSchema } from "./status";

// Limits (adjust to taste)

export const TodoChildrenItemSchema = z
    .object({
        id: ChildIdSchema,
        content: contentField.describe("Subtask description"),
        status: TodoStatusSchema,
        priority: PrioritySchema.optional().describe("Optional subtask priority."),
        note: noteField.optional(),
    })
    .strict();

export const TodoRootItemSchema = z
    .object({
        id: RootIdSchema,
        content: contentField.describe("Main task summary"),
        status: TodoStatusSchema,
        priority: PrioritySchema.optional().describe("Optional task priority."),
        note: noteField.optional(),
        children: z
            .preprocess(
                (value) => (typeof value === "string" ? safeParseJson(value) : value),
                z.array(TodoChildrenItemSchema).min(1).max(MAX_CHILDREN),
            )
            .optional()
            .describe(
                `Optional subtasks (1-${MAX_CHILDREN}). Each id must be <root_id>.<n>, e.g. 1.1. Omit the field when there are none.`,
            ),
    })
    .superRefine((root, ctx) => {
        if (!root.children) return;

        const seen = new Set<number>();
        root.children.forEach((child, i) => {
            if (Math.floor(child.id) !== root.id) {
                ctx.addIssue({
                    code: "custom",
                    path: ["children", i, "id"],
                    message: `Child id ${child.id} must start with ${root.id}. (e.g. ${root.id}.1)`,
                });
            }
            if (seen.has(child.id)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["children", i, "id"],
                    message: `Duplicate child id ${child.id}`,
                });
            }
            seen.add(child.id);
        });
    })
    .strict();

export const TodoListSchema = z
    .array(TodoRootItemSchema)
    .max(MAX_ROOTS, {
        error: `At most ${MAX_ROOTS} root todos per list; group related work into subtasks.`,
    })
    .superRefine((todos, ctx) => {
        const seen = new Set<number>();
        todos.forEach((todo, i) => {
            if (seen.has(todo.id)) {
                ctx.addIssue({
                    code: "custom",
                    path: [i, "id"],
                    message: `Duplicate root id ${todo.id}`,
                });
            }
            seen.add(todo.id);
        });
    })
    .describe("Hierarchical task list");

export type TodoChildren = z.infer<typeof TodoChildrenItemSchema>;
export type TodoRootItem = z.infer<typeof TodoRootItemSchema>;
export type TodoList = z.infer<typeof TodoListSchema>;

export type TodoChildrenRaw = z.input<typeof TodoChildrenItemSchema>;
export type TodoRootRaw = z.input<typeof TodoRootItemSchema>;
export type TodoListRaw = z.input<typeof TodoListSchema>;
