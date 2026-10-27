import z from "zod";
import { safeParseJson } from "../../utils/parseJson";
import { TodoListSchema } from "./item";

const createOperation = z
    .literal("create")
    .describe(
        "'create' a new todo list. Rejected while any todo is still pending or in progress.",
    );

const todos = z
    .preprocess(
        (value) => (typeof value === "string" ? safeParseJson(value) : value),
        TodoListSchema.min(1, { error: "Provide at least one todo." }),
    )
    .describe("Required. At least one todo.");

export const TodoCreateOperationSchema = z
    .object({
        operation: createOperation,
        todos,
    })
    .strict();

export type TodoCreateOperationInput = z.infer<
    typeof TodoCreateOperationSchema
>;
export type TodoCreateOperationRaw = z.input<typeof TodoCreateOperationSchema>;
