import z from "zod";

export const TodoClearOperationSchema = z
    .object({
        operation: z
            .literal("clear")
            .describe(
                "'clear' the whole todo list. Rejected while any todo is still open (pending, in progress or error).",
            ),
    })
    .strict();

export type TodoClearOperationInput = z.infer<typeof TodoClearOperationSchema>;
export type TodoClearOperationRaw = z.input<typeof TodoClearOperationSchema>;
