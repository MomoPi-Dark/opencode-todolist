import { Plugin } from "@opencode/plugin";
import { TodoInputToolSchema, TodoOutputToolSchema } from "./schemas/todo/index";
import { registerTodoSkills } from "./skills/loader";
import {
  getMigrationWarning,
  readTodos,
  updateTodos,
} from "./storage/todo-store";
import { handleClear } from "./todos/handlers/clear";
import { handleCreate } from "./todos/handlers/create";
import { handleRead } from "./todos/handlers/read";
import { handleUpdate } from "./todos/handlers/update";
import { registerTodoPromptHook } from "./todos/hint";
import {
  toToolResult,
  type TodoOperationResult,
} from "./todos/handlers/types";

class OperationRejected extends Error {
  constructor(readonly result: TodoOperationResult) {
    super(result.ok ? "Todo operation rejected" : result.message);
    this.name = "OperationRejected";
  }
}

async function registerTodoTools(ctx: Plugin.Context): Promise<void> {
  await ctx.tool.transform((tools) => {
    tools.add({
      name: "manage_todo_list",
      description:
        "Track multi-step work (3+ steps) in a hierarchical todo list. Operations: read, create, update, clear. Supports status, priority, notes, and subtasks; read first when unsure of the current state.",
      input: TodoInputToolSchema,
      output: TodoOutputToolSchema,
      options: { codemode: false },
      execute: async (input, toolContext) => {
        const parsed = TodoInputToolSchema.safeParse(input);
        if (!parsed.success) {
          throw new Error(
            `Invalid manage_todo_list input: ${parsed.error.issues
              .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
              .join(", ")}`,
          );
        }

        const { sessionID } = toolContext;
        const data = parsed.data;

        // An incomplete upgrade must not look like an empty list: prepend the
        // warning to whatever the operation returns. Cheap check, runs only
        // while legacy files are still unimported.
        const withMigrationNotice = (result: ReturnType<typeof toToolResult>) => {
          const warning = getMigrationWarning();
          return warning === undefined
            ? result
            : { ...result, content: `${warning}\n\n${result.content}` };
        };

        switch (data.operation) {
          case "read":
            return withMigrationNotice(
              toToolResult(handleRead(await readTodos(sessionID), data)),
            );

          case "create": {
            let accepted: TodoOperationResult | undefined;
            try {
              const todos = await updateTodos(sessionID, (current) => {
                const result = handleCreate(current, data);
                if (!result.ok) throw new OperationRejected(result);
                accepted = result;
                return result.todos;
              });
              return withMigrationNotice(
                toToolResult(
                  accepted ?? {
                    ok: true,
                    todos,
                    content: "Created.",
                  },
                ),
              );
            } catch (error) {
              if (error instanceof OperationRejected) {
                return toToolResult(error.result);
              }
              throw error;
            }
          }

          case "update": {
            return toToolResult(await handleUpdate(sessionID, data));
          }

          case "clear": {
            let accepted: TodoOperationResult | undefined;
            try {
              const todos = await updateTodos(sessionID, (current) => {
                const result = handleClear(current, data);
                if (!result.ok) throw new OperationRejected(result);
                accepted = result;
                return result.todos;
              });
              return toToolResult(
                accepted ?? {
                  ok: true,
                  todos,
                  content: "Cleared.",
                },
              );
            } catch (error) {
              if (error instanceof OperationRejected) {
                return toToolResult(error.result);
              }
              throw error;
            }
          }

          default: {
            // Compile error here means a new operation was added to the schema
            // without a branch in this switch.
            const unreachable: never = data;
            throw new Error(
              `Unsupported operation: ${JSON.stringify(unreachable)}`,
            );
          }
        }
      },
    });
  });

  await registerTodoSkills(ctx);
  await registerTodoPromptHook(ctx);
}

export default Plugin.define({
  id: "todolist.tool",
  setup: registerTodoTools,
});
