import z from "zod";
import { RootIdSchema, TodoTargetIdSchema } from "./id";

const readOperation = z
    .literal("read")
    .describe("'read' to inspect current todos.");

const formatOption = z
    .enum(["tree", "summary"])
    .default("tree")
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
        target: TodoTargetIdSchema,
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

// `read` is a discriminated union on `scope`, so an impossible combination
// cannot be written at all: `target` exists only alongside `scope: "item"`
// and `"root"`, neither of which is valid without one. `.strict()` on every
// member is what enforces that: without it `{ scope: "all", target: 1 }`
// would parse and silently ignore `target`.
//
// An omitted `scope` must still behave as "all", so a bare
// `{ operation: "read" }` keeps working. A discriminated union looks at the raw
// input before defaults are applied, so `unionFallback` retries the members as
// a plain union when no discriminator matches; `TodoReadAllSchema` then accepts
// the input and fills in `scope: "all"`.
export const TodoReadOperationSchema = z.discriminatedUnion(
    "scope",
    [TodoReadAllSchema, TodoReadItemSchema, TodoReadRootSchema],
    { unionFallback: true },
);

export type TodoReadAllInput = z.infer<typeof TodoReadAllSchema>;
export type TodoReadItemInput = z.infer<typeof TodoReadItemSchema>;
export type TodoReadRootInput = z.infer<typeof TodoReadRootSchema>;
export type TodoReadInput = z.infer<typeof TodoReadOperationSchema>;
export type TodoReadScope = TodoReadInput["scope"];

// Pre-parse shape, for callers that build tool input (clients, tests).
export type TodoReadInputRaw = z.input<typeof TodoReadOperationSchema>;
