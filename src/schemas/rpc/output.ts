import z from "zod";
import { TodoListSchema } from "../todo/item";
import { TodoOperationErrorSchema } from "./error";

const TodoOperationOutputErrorSchema = z.object({
  ok: z.literal(false),
  todos: TodoListSchema,
  error: TodoOperationErrorSchema,
});

const TodoOperationOutputSuccessSchema = z.object({
  ok: z.literal(true),
  todos: TodoListSchema,
  content: z.string().optional(),
});

export const TodoOperationOutputSchema = z.discriminatedUnion("ok", [
  TodoOperationOutputSuccessSchema,
  TodoOperationOutputErrorSchema,
]);

export type TodoOperationOutput = z.infer<typeof TodoOperationOutputSchema>;
