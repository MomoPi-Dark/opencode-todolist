import z from "zod";
import { PrioritySchema, TodoStatusSchema } from "./status.schema";

// Child id format: <root_id>.<n> as a number -> 1.1, 2.3, etc.
// Only a single decimal digit (1-9) is allowed, see the note below.
const ChildIdSchema = z
  .number()
  .refine((n) => /^[1-9]\d*\.[1-9]$/.test(String(n)), {
    message:
      "Child id must follow the format <root_id>.<n> with n from 1 to 9, e.g. 1.1",
  })
  .describe("Unique subtask identifier, format <root_id>.<n> (e.g. 1.1)");

// TodoItem Children SCHEMA
export const TodoChildernItemSchema = z.object({
  id: ChildIdSchema,
  content: z.string().describe("Subtask description"),
  status: TodoStatusSchema,
  priority: PrioritySchema.optional(),
  note: z.string().optional(),
});

export type TodoChildern = z.infer<typeof TodoChildernItemSchema>;

// TodoItem Root SCHEMA
export const TodoRootItemSchema = z
  .object({
    id: z.number().int().positive().describe("Unique task identifier (e.g. 1)"),
    content: z.string().describe("Main task summary"),
    status: TodoStatusSchema,
    priority: PrioritySchema.optional(),
    note: z.string().optional(),
    children: z.array(TodoChildernItemSchema).max(9).optional(),
  })
  .superRefine((root, ctx) => {
    const seen = new Set<number>();
    if (root.children) {
      root.children.forEach((child, i) => {
        // The integer part of the child id must match the parent root id
        if (Math.floor(child.id) !== root.id) {
          ctx.addIssue({
            code: "custom",
            path: ["children", i, "id"],
            message: `Child id ${child.id} must start with ${root.id}. (e.g. ${root.id}.1)`,
          });
        }

        // Child ids must be unique within the same root
        if (seen.has(child.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["children", i, "id"],
            message: `Duplicate child id ${child.id}`,
          });
        }
        seen.add(child.id);
      });
    }
  });
export type TodoRootItem = z.infer<typeof TodoRootItemSchema>;

// Display helpers
export const formatRootId = (id: number) => `${id}.`;
export const formatChildId = (id: number) => String(id);

// Full todolist: root ids must be unique across the whole list
export const TodoListSchema = z
  .array(TodoRootItemSchema)
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

// TodoHook Write Input
export const TodoWriteInputSchema = z.object({
  todos: TodoListSchema,
});
export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;

export const TodoTargetIdSchema = z
  .number()
  .positive()
  .refine(
    (id) => Number.isInteger(id) || /^[1-9]\d*\.[1-9]$/.test(String(id)),
    "ID must be a root number or child number such as 1 or 1.1",
  );

// TodoHook Tool Schema
export const TodoReadOperationSchema = z
  .object({
    operation: z.literal("read").describe("'read' to inspect current todos."),
  })
  .strict();

export const TodoWriteOperationSchema = z
  .object({
    operation: z
      .literal("write")
      .describe("'write' to initialize an empty list."),
    todos: TodoListSchema.describe(
      "Required for 'write'. Pass [] to clear the list.",
    ),
  })
  .strict();

export const TodoUpdateOperationSchema = z
  .object({
    operation: z.literal("update").describe("'update' one root or child todo."),
    id: TodoTargetIdSchema.describe("Root or child todo ID, e.g. 1 or 1.1"),
    status: TodoStatusSchema.describe("New status for the target todo."),
    content: z.string().optional(),
    priority: PrioritySchema.nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .strict();
export type TodoUpdateInput = z.infer<typeof TodoUpdateOperationSchema>;

export const TodoInputToolSchema = z.discriminatedUnion("operation", [
  TodoReadOperationSchema,
  TodoWriteOperationSchema,
  TodoUpdateOperationSchema,
]);
export type TodoInputTool = z.infer<typeof TodoInputToolSchema>;

export const TodoOutputToolSchema = z.object({
  todos: z.array(TodoRootItemSchema),
});
export type TodoOutputTool = z.infer<typeof TodoOutputToolSchema>;
