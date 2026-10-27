import z from "zod";
import { TodoClearOperationSchema } from "./clear";
import { TodoCreateOperationSchema } from "./create";
import { TodoListSchema } from "./item";
import { TodoReadOperationSchema } from "./read";
import { TodoUpdateOperationSchema } from "./update";

export const TodoInputToolSchema = z.discriminatedUnion("operation", [
    TodoReadOperationSchema,
    TodoCreateOperationSchema,
    TodoUpdateOperationSchema,
    TodoClearOperationSchema,
]);
export type TodoInputTool = z.infer<typeof TodoInputToolSchema>;

export const TodoOutputToolSchema = z.object({
    todos: TodoListSchema,
});
export type TodoOutputTool = z.infer<typeof TodoOutputToolSchema>;
