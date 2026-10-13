import { Plugin } from "@opencode/plugin";
import {
  TodoInputToolSchema,
  TodoOutputToolSchema,
  type TodoRootItem,
} from "./schemas/todo";
import { registerTodoSkills } from "./skills/loader";
import { readTodoData, readTodos, updateTodos } from "./storage/todo-store";
import {
  buildTodoHint,
  consumeTodoHint,
  findNextTodo,
  findStuckParent,
  flattenLeaves,
  isAnyTodoActive,
} from "./todos/hint";
import { TodoTree } from "./todos/todo-tree";
import { updateTodoById } from "./todos/update";

export function formatReadOutput(todos: readonly TodoRootItem[]): string {
  if (todos.length === 0) return "No todos recorded.";

  const tree = new TodoTree(todos).render();
  const check = new TodoTree(todos).validateAndNormalize();
  if (check.valid) return tree;

  return `Warning: the stored list needs fixing — ${check.error}\n${tree}`;
}

export function formatTransitionLines(
  before: readonly TodoRootItem[],
  after: readonly TodoRootItem[],
): string[] {
  const previous = new Map(
    flattenLeaves(before).map((leaf) => [leaf.id, leaf.status] as const),
  );
  const leaves = flattenLeaves(after);
  const total = leaves.length;
  const completed: string[] = [];
  const started: string[] = [];
  const failed: string[] = [];

  leaves.forEach((leaf, index) => {
    const was = previous.get(leaf.id);
    const label = `(${index + 1}/${total}): ${leaf.content}`;
    if (
      leaf.status === "completed" &&
      was !== undefined &&
      was !== "completed"
    ) {
      completed.push(`✓\uFE0E  Completed ${label}`);
    } else if (leaf.status === "in_progress" && was !== "in_progress") {
      started.push(`▶\uFE0E  Starting ${label}`);
    } else if (
      leaf.status === "error" &&
      was !== undefined &&
      was !== "error"
    ) {
      failed.push(
        `✗\uFE0E  Error ${label}${leaf.note ? ` — ${leaf.note}` : ""}`,
      );
    }
  });

  return [...completed, ...started, ...failed];
}

export function formatWriteOutput(
  todos: readonly TodoRootItem[],
  before: readonly TodoRootItem[] = [],
): string {
  const stats = new TodoTree(todos).calculateStats();
  const base = `Todos (${stats.completedSubTasks}/${stats.totalSubTasks}) updated.`;
  const next = findNextTodo(todos);
  const stuck = findStuckParent(todos);

  const head = next
    ? `${base} Next: ${next.id} "${next.content}". Continue immediately.`
    : stuck
      ? `${base} All children of ${stuck.id} "${stuck.content}" are done. Set ${stuck.id} to completed (or cancelled) to finish it.`
      : isAnyTodoActive(todos)
        ? `${base} Open items remain. Call manage_todo_list [read] and resolve them.`
        : `${base} All todos finished.`;

  const lines = formatTransitionLines(before, todos);
  if (lines.length === 0) return head;
  return `${head}\nPrint these lines to chat verbatim, then continue:\n${lines.join("\n")}`;
}

export function assertWriteIsInitialization(
  existing: readonly TodoRootItem[],
  incoming: readonly TodoRootItem[],
): void {
  if (existing.length > 0 && incoming.length > 0) {
    const messages = [
      '[manage_todo_list] Invalid operation: "write".',
      "",
      'The "write" operation is only allowed during initialization.',
      'Use "update" to modify an existing todo list.',
      'To replace the entire list, use "write" with "todos:[]".',
    ];
    throw new Error(messages.join("\n"));
  }
}

/** Update response: progress, next step, and transition lines without resending the list. */
export function formatUpdateOutput(
  todos: readonly TodoRootItem[],
  before: readonly TodoRootItem[] = [],
): string {
  const stats = new TodoTree(todos).calculateStats();
  const progress = `Todos (${stats.completedSubTasks}/${stats.totalSubTasks}).`;
  return formatWriteOutput(todos, before).replace(
    /^Todos \(\d+\/\d+\) updated\./,
    progress.slice(0, -1),
  );
}

export async function registerTodoTools(ctx: Plugin.Context): Promise<void> {
  await ctx.tool.transform((tools) => {
    tools.add({
      name: "manage_todo_list",
      description:
        "Manage the todo list for multi-step tasks. Use non-empty 'write' only to initialize; use 'write' with [] to clear; use 'update' for existing items. " +
        "Rules enforced: one root at a time in order — root 2 cannot start while root 1 is still open; only a root in 'error' may be fixed early, and only inside that root. " +
        "Only one task/subtask may be 'in_progress'; progress never moves backward and finished items are locked. " +
        "Mark items completed right after they are verified. " +
        "Keep working through open items without asking permission to continue. " +
        "Call 'read' first if unsure of current state, as tasks can be cleared by user via UI.",
      input: TodoInputToolSchema,
      output: TodoOutputToolSchema,
      options: { codemode: false },
      execute: async (input, toolContext) => {
        const parsed = TodoInputToolSchema.safeParse(input);
        if (!parsed.success) {
          throw new Error(
            `[manage_todo_list validation failed] ${parsed.error.issues
              .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
              .join(", ")}`,
          );
        }

        if (parsed.data.operation === "read") {
          const todos = await readTodos(toolContext.sessionID);
          return { output: { todos }, content: formatReadOutput(todos) };
        }

        if (parsed.data.operation === "update") {
          const updateInput = parsed.data;
          let updated: ReturnType<typeof updateTodoById>["updated"];
          let before: TodoRootItem[] = [];
          const todos = await updateTodos(toolContext.sessionID, (current) => {
            before = current;
            const result = updateTodoById(current, updateInput);
            updated = result.updated;
            return result.todos;
          });

          return {
            output: { todos },
            content: `Updated ${updated!.scope} todo ${updated!.id}. ${formatUpdateOutput(todos, before)}`,
          };
        }

        const rawTodos = parsed.data.todos;
        assertWriteIsInitialization(
          readTodoData(toolContext.sessionID)?.todos ?? [],
          rawTodos,
        );
        if (rawTodos.length === 0) {
          await updateTodos(toolContext.sessionID, () => []);
          return { output: { todos: [] }, content: "Cleared all todos." };
        }

        let before: TodoRootItem[] = [];
        const todos = await updateTodos(toolContext.sessionID, (current) => {
          before = current;
          return rawTodos;
        });

        return { output: { todos }, content: formatWriteOutput(todos, before) };
      },
    });
  });

  await registerTodoSkills(ctx);
  await registerTodoPromptHook(ctx);
}

export async function registerTodoPromptHook(
  ctx: Plugin.Context,
): Promise<void> {
  if (typeof ctx.session?.hook !== "function") return;

  const debug = process.env.TODO_HINT_DEBUG === "1";

  try {
    await ctx.session.hook("context", async (sessionContext) => {
      try {
        const system = sessionContext.system;
        if (!Array.isArray(system)) {
          if (debug) console.error("[todo] system is not an array");
          return;
        }
        const hint = buildTodoHint(sessionContext.sessionID);
        if (!hint) return;
        system.push({ type: "text", text: hint });
        if (debug)
          console.error("[todo] hint injected", sessionContext.sessionID);
      } catch {
        // Fail-safe
      }
    });
    return;
  } catch {
    // Fallback
  }

  try {
    await ctx.session.hook("prompt", async (sessionPrompt) => {
      try {
        if (!sessionPrompt.prompt?.text?.trim()) return;
        const hint = consumeTodoHint(sessionPrompt.sessionID);
        if (hint) {
          sessionPrompt.prompt.text = `${sessionPrompt.prompt.text}\n\n${hint}`;
        }
      } catch {
        // Fail-safe
      }
    });
  } catch {
    // Graceful degradation
  }
}

export default Plugin.define({
  id: "opencode.todolist.tool1",
  setup: registerTodoTools,
});
