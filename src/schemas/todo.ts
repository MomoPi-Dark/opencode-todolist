import z from "zod";
import { PrioritySchema, TodoStatusSchema } from "./status";

// Some providers stringify array arguments before calling the tool. Parse them
// back so validation (and the harness's standard-schema check) see real arrays.
function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Accepts `"1"` as well as `1`.
 *
 * Models routinely send numeric ids as JSON strings, and the JSON Schema handed
 * to the provider declares `integer`, so a quoted id would otherwise be rejected
 * by the runtime before `execute` ever sees it. Coercion has to happen here —
 * in the schema the runtime validates against — not inside the handler.
 *
 * `z.preprocess` is used instead of `z.coerce.number()` on purpose: `coerce`
 * turns `true` into `1` and rewrites the emitted JSON Schema to a bare
 * `type: integer`, which loses the `anyOf` branch descriptions the model reads.
 * A preprocess step keeps both branch schemas intact.
 */
const numericId = (value: unknown): unknown =>
  typeof value === "string" && value.trim() !== "" ? Number(value) : value;

/** A top-level id only: `1`, `2`, ... — never a dotted subtask id. */
export const RootIdSchema = z
  .preprocess(
    numericId,
    z
      .number()
      .int()
      .positive()
      .describe("Unique task identifier (e.g. 1)"),
  );

// Child id format: <root_id>.<n> as a number -> 1.1, 2.3, etc.
// Only a single decimal digit (1-9) is allowed, see the note below.
export const ChildIdSchema = z
  .preprocess(
    numericId,
    z
      .number()
      .refine((n) => /^[1-9]\d*\.[1-9]$/.test(String(n)), {
        message:
          "Child id must follow the format <root_id>.<n> with n from 1 to 9, e.g. 1.1",
      })
      .describe("Unique subtask identifier, format <root_id>.<n> (e.g. 1.1)"),
  );

// Root or child id, composed from the two schemas above so the id rules
// live in exactly one place. The union carries its own message so a bad id
// reports the expected shape instead of zod's generic "Invalid input".
export const TodoTargetIdSchema = z
  .union([RootIdSchema, ChildIdSchema], {
    error:
      "id must be a number like 1 (root) or 1.1 (subtask); remove the quotes",
  })
  .describe("Root or child todo id, e.g. 1 or 1.1");

// TodoItem Children SCHEMA
export const TodoChildrenItemSchema = z
  .object({
    id: ChildIdSchema,
    content: z.string().describe("Subtask description"),
    status: TodoStatusSchema,
    priority: PrioritySchema.optional(),
    note: z.string().optional(),
  })
  .strict();

// TodoItem Root SCHEMA
export const TodoRootItemSchema = z
  .object({
    id: RootIdSchema,
    content: z.string().describe("Main task summary"),
    status: TodoStatusSchema,
    priority: PrioritySchema.optional(),
    note: z.string().optional(),
    children: z
      .preprocess(
        (value) =>
          typeof value === "string" ? safeParseJson(value) : value,
        z.array(TodoChildrenItemSchema).max(9),
      )
      .optional(),
  })
  .strict()
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

// TodoHook Tool Schema
//
// `read` is a discriminated union on `scope`, so an impossible combination
// cannot be written at all: `target` exists only alongside `scope: "item"`,
// `"children"` and `"root"`, none of which is valid without one. `.strict()`
// on every member is what enforces that — without it
// `{ scope: "all", target: 1 }` would parse and silently ignore `target`.
//
// An omitted `scope` defaults to "all", so a bare `{ operation: "read" }` keeps
// behaving exactly as it did before this option existed. That default has to
// live on the discriminator itself; a member without `scope` is rejected at
// construction time.
const readOperation = z
  .literal("read")
  .describe("'read' to inspect current todos.");

const formatOption = z
  .enum(["tree", "summary"])
  .default("tree")
  .optional()
  .describe(
    "Output format: 'tree' for standard tree view, 'summary' for compact completed summary.",
  );

export const TodoReadAllSchema = z
  .object({
    operation: readOperation,
    format: formatOption,
    scope: z
      .literal("all")
      .default("all")
      .describe("Default. Return the whole list."),
  })
  .strict();

export const TodoReadItemSchema = z
  .object({
    operation: readOperation,
    format: formatOption,
    scope: z.literal("item").describe("Return only the targeted item."),
    target: TodoTargetIdSchema.describe(
      "Root or child todo id, e.g. 1 or 1.1.",
    ),
  })
  .strict();

export const TodoReadChildrenSchema = z
  .object({
    operation: readOperation,
    format: formatOption,
    scope: z
      .literal("children")
      .describe(
        "Return one root and its subtasks. The root is included as context.",
      ),
    target: ChildIdSchema.describe(
      "A subtask id such as 1.1; its root is resolved from the id.",
    ),
  })
  .strict();

export const TodoReadRootSchema = z
  .object({
    operation: readOperation,
    format: formatOption,
    scope: z
      .literal("root")
      .describe("Return exactly one root together with all of its subtasks."),
    target: RootIdSchema.describe("Root todo id, e.g. 1."),
  })
  .strict();

export const TodoReadOperationSchema = z.discriminatedUnion("scope", [
  TodoReadAllSchema,
  TodoReadItemSchema,
  TodoReadChildrenSchema,
  TodoReadRootSchema,
]);

export const TodoWriteOperationSchema = z
  .object({
    operation: z
      .literal("write")
      .describe("'write' to replace the whole list. Pass [] to clear it."),
    todos: z
      .preprocess(
        (value) =>
          typeof value === "string" ? safeParseJson(value) : value,
        TodoListSchema,
      )
      .describe("Required for 'write'. Pass [] to clear the list."),
  })
  .strict();

/**
 * One todo to change. Shared by the single object and the array form of
 * `updates`, so a field can never exist in one shape but not the other.
 */
export const TodoUpdateItemSchema = z
  .object({
    id: TodoTargetIdSchema,
    status: TodoStatusSchema.describe("New status for this todo."),
    content: z.string().optional(),
    priority: PrioritySchema.nullable().optional(),
    note: z.string().nullable().optional(),
    cancel_remaining: z
      .boolean()
      .optional()
      .describe(
        "If true, automatically cancels any remaining pending subtasks in the target root when marking this task error or cancelled.",
      ),
  })
  .strict();

/**
 * `updates` accepts one object or up to two, applied in array order.
 *
 * Two is the maximum because the order rules only ever allow one legitimate
 * pair: finish the item that is running, then start the next one. A third
 * entry could only be an attempt to skip a step, which the order validation
 * would reject anyway — refusing it here keeps that failure at the schema
 * boundary instead of inside a transaction.
 *
 * The object form is normalised to a one-element array so the handler has a
 * single shape to work with.
 */
export const TodoUpdateOperationSchema = z
  .object({
    operation: z
      .literal("update")
      .describe("'update' one or two todos, applied in order."),
    updates: z.preprocess(
      (value) => (typeof value === "string" ? safeParseJson(value) : value),
      z.union([
        TodoUpdateItemSchema,
        z.array(TodoUpdateItemSchema).min(1).max(2),
      ]).transform((value) => (Array.isArray(value) ? value : [value])),
    ),
  })
  .strict();

export const TodoInputToolSchema = z.discriminatedUnion("operation", [
  TodoReadOperationSchema,
  TodoWriteOperationSchema,
  TodoUpdateOperationSchema,
]);

export const TodoOutputToolSchema = z.object({
  todos: TodoListSchema,
});

// Types
export type TodoChildren = z.infer<typeof TodoChildrenItemSchema>;
export type TodoRootItem = z.infer<typeof TodoRootItemSchema>;

export type TodoReadAllInput = z.infer<typeof TodoReadAllSchema>;
export type TodoReadItemInput = z.infer<typeof TodoReadItemSchema>;
export type TodoReadChildrenInput = z.infer<typeof TodoReadChildrenSchema>;
export type TodoReadRootInput = z.infer<typeof TodoReadRootSchema>;
export type TodoReadInput = z.infer<typeof TodoReadOperationSchema>;
export type TodoReadScope = TodoReadInput["scope"];

export type TodoWriteOperationInput = z.infer<typeof TodoWriteOperationSchema>;
export type TodoUpdateItem = z.infer<typeof TodoUpdateItemSchema>;
/** Always an array, even when the caller sent a single object. */
export type TodoUpdateBatch = readonly TodoUpdateItem[];
export type TodoUpdateInput = z.infer<typeof TodoUpdateOperationSchema>;
export type TodoInputTool = z.infer<typeof TodoInputToolSchema>;
export type TodoOutputTool = z.infer<typeof TodoOutputToolSchema>;
