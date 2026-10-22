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
import { formatCompactSummary, formatReadOutput, runReadOperation } from "./todos/read";
import { TodoTree } from "./todos/todo-tree";
import { updateTodoById } from "./todos/update";

export { formatCompactSummary, formatReadOutput };

const STATUS_MARK = {
  completed: "✓\uFE0E",
  in_progress: "▶\uFE0E",
  error: "✗\uFE0E",
  cancelled: "⊘\uFE0E",
} as const;

/**
 * Status changes produced by one call.
 *
 * `changedIds` is returned alongside the rendered lines so the caller can avoid
 * naming the same item twice: `Next:` is only worth printing when it points
 * somewhere other than the row that just moved.
 */
export interface TransitionSummary {
  readonly lines: string[];
  readonly changedIds: ReadonlySet<number>;
}

export function summarizeTransitions(
  before: readonly TodoRootItem[],
  after: readonly TodoRootItem[],
): TransitionSummary {
  const previous = new Map(
    flattenLeaves(before).map((leaf) => [leaf.id, leaf.status] as const),
  );
  const leaves = flattenLeaves(after);
  const total = leaves.length;
  const lines: string[] = [];
  const changedIds = new Set<number>();

  leaves.forEach((leaf, index) => {
    const was = previous.get(leaf.id);
    if (was === leaf.status) return;
    // A leaf already present at its starting status is not a transition.
    if (was === undefined && leaf.status !== "in_progress") return;

    const label = `${index + 1}/${total}: ${leaf.content}`;
    if (leaf.status === "completed") {
      changedIds.add(leaf.id);
      lines.push(`${STATUS_MARK.completed} ${label}`);
    } else if (leaf.status === "in_progress") {
      changedIds.add(leaf.id);
      lines.push(`${STATUS_MARK.in_progress} ${label}`);
    } else if (leaf.status === "error") {
      changedIds.add(leaf.id);
      lines.push(
        `${STATUS_MARK.error} ${label}${leaf.note ? ` — ${leaf.note}` : ""}`,
      );
    } else if (leaf.status === "cancelled") {
      changedIds.add(leaf.id);
      lines.push(`${STATUS_MARK.cancelled} ${label}`);
    }
  });

  return { lines, changedIds };
}

export function formatWriteOutput(
  todos: readonly TodoRootItem[],
  before: readonly TodoRootItem[] = [],
): string {
  const stats = new TodoTree(todos).calculateStats();
  const base = `Todos (${stats.completedSubTasks}/${stats.totalSubTasks}).`;
  const next = findNextTodo(todos);
  const stuck = findStuckParent(todos);
  const { lines, changedIds } = summarizeTransitions(before, todos);

  // Only name the next step when it is not the row that just moved: repeating
  // it would spend tokens on information the transition line already carries.
  // A stuck parent reads better as an instruction than as another `Next:`.
  const nextLine =
    next && !changedIds.has(next.id)
      ? stuck && stuck.id === next.id
        ? `Mark ${next.id} done.`
        : `Next: ${next.id} ${next.content}`
      : undefined;

  const tail = next
    ? undefined
    : stuck
      ? `Mark ${stuck.id} done.`
      : isAnyTodoActive(todos)
        ? undefined
        : "All done.";

  return [base, nextLine, ...lines, tail].filter(Boolean).join("\n");
}

export function assertWriteIsInitialization(
  existing: readonly TodoRootItem[],
  incoming: readonly TodoRootItem[],
): void {
  if (existing.length > 0 && incoming.length > 0) {
    const messages = [
      'Invalid operation: "write".',
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
  return formatWriteOutput(todos, before);
}

export async function registerTodoTools(ctx: Plugin.Context): Promise<void> {
  await ctx.tool.transform((tools) => {
    tools.add({
      name: "manage_todo_list",
       description: [
         "Manage a todo list for multi-step work. Use it when a task has 3+ steps.",
         "",
         "Statuses: pending, in_progress, completed, cancelled, error.",
         "",
         "Operations:",
         "- read: show the list. Call this first if unsure of the current state.",
         "- write: replace the whole list. todos: [] clears it.",
         "- update: change status of 1 todo, or 2 in order (max 2).",
         "",
         "Update examples:",
         '{ operation: "update", updates: { id: "1.1", status: "completed" } }',
         '{ operation: "update", updates: [{ id: "1.1", status: "completed" }, { id: "1.2", status: "in_progress" }] }',
         "",
         "Rules:",
         "- Roots run in order. Only the first unfinished root can change.",
         "- Only one item can be in_progress at a time.",
         "- completed and cancelled are final.",
         "- An error root can be fixed early, only inside that root.",
         "- Mark done right after finishing each item.",
         "",
         "Keep working through open todos without asking permission.",
       ].join("\n"),
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

        if (parsed.data.operation === "read") {
          const todos = await readTodos(toolContext.sessionID);
          const result = runReadOperation(todos, parsed.data);
          return {
            output: { todos: result.todos },
            content: result.content,
          };
        }

        if (parsed.data.operation === "update") {
          const updateInput = parsed.data.updates;
          let before: TodoRootItem[] = [];
          const todos = await updateTodos(toolContext.sessionID, (current) => {
            before = current;
            return updateTodoById(current, updateInput).todos;
          });

          return {
            output: { todos },
            content: formatUpdateOutput(todos, before),
          };
        }

        const rawTodos = parsed.data.todos;
        assertWriteIsInitialization(
          readTodoData(toolContext.sessionID)?.todos ?? [],
          rawTodos,
        );
        if (rawTodos.length === 0) {
          await updateTodos(toolContext.sessionID, () => []);
          return { output: { todos: [] }, content: "Cleared." };
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
  const inject = async (sessionContext: {
    sessionID: string;
    system: Array<{ type: "text"; text: string }>;
  }) => {
    try {
      if (!Array.isArray(sessionContext.system)) return;
      if (
        sessionContext.system.some(
          (part) => part.type === "text" && part.text.includes("<todo_state>"),
        )
      ) {
        return;
      }
      const hint = buildTodoHint(sessionContext.sessionID);
      if (!hint) return;
      sessionContext.system.push({ type: "text", text: hint });
      if (debug) console.error("[todo] hint injected", sessionContext.sessionID);
    } catch {
      // Fail-safe
    }
  };

  try {
    await Promise.all([
      ctx.session.hook("context", inject),
      ctx.session.hook("compaction", inject),
      ctx.session.hook("generate", inject),
    ]);
      return;
    } catch {
      if (debug)
        console.error("[todo] model context hooks unavailable; using prompt fallback");
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
  id: "opencode.todolist.tool",
  setup: registerTodoTools,
});
