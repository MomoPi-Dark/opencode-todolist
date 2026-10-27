import z from "zod";

export const TodoClearOperationSchema = z
    .object({
        operation: z
            .literal("clear")
            .describe(
                "'clear' the whole todo list. Rejected while any todo is still open (pending, in progress or error).",
            ),
        confirm: z
            .literal(true, { error: "Pass confirm: true to clear the list." })
            .describe("Must be true. Guards against clearing by accident."),
    })
    .strict();

export type TodoClearOperationInput = z.infer<typeof TodoClearOperationSchema>;
export type TodoClearOperationRaw = z.input<typeof TodoClearOperationSchema>;
