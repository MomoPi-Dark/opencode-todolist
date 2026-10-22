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
import { runReadOperation } from "./todos/read";
import { TodoTree } from "./todos/todo-tree";
import { updateTodoById } from "./todos/update";

const STATUS_MARK = {
  completed: "✓\uFE0E",
  in_progress: "▶\uFE0E",
  error: "✗\uFE0E",
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
          const updateInput = parsed.data;
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
