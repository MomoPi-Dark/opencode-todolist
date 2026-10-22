import type { TodoReadInput, TodoRootItem } from "../schemas/todo";
import { TodoTree } from "./todo-tree";

/**
 * Render a list as the tree the `read` operation answers with.
 *
 * A list that fails validation still renders — showing the rows is more useful
 * than refusing — but the warning goes first so the caller fixes it before
 * trusting the shape.
 */
export function formatReadOutput(
  todos: readonly TodoRootItem[],
  options?: { visibleIds?: readonly number[] },
): string {
  if (todos.length === 0) return "No todos recorded.";

  const tree = new TodoTree(todos).render(options);
  const check = new TodoTree(todos).validateAndNormalize();
  if (check.valid) return tree;

  return `Warning: the stored list needs fixing — ${check.error}\n${tree}`;
}

/**
 * Narrows a list for a scoped read.
 *
 * - `scope: "root"` returns one root with every subtask, so the whole branch is
 *   visible.
 * - `scope: "children"` prints the root line as context plus the targeted
 *   subtask line, matching a "show me this subtask within its root" read.
 * - `scope: "item"` prints only the targeted row.
 *
 * Either way the root keeps every subtask in the *data*, because the root's
 * `(completed/total)` label is computed from them — dropping them would
 * silently turn `(2/2)` into `(1/1)`.
 */
export function selectReadScope(
  todos: readonly TodoRootItem[],
  input: TodoReadInput,
): { todos: TodoRootItem[]; visibleIds?: readonly number[] } {
  if (
    input.scope !== "item" &&
    input.scope !== "children" &&
    input.scope !== "root"
  ) {
    return { todos: [...todos] };
  }

  const target = input.target;
  const rootId = Number.isInteger(target) ? target : Math.floor(target);
  const root = todos.find((item) => item.id === rootId);
  const child = Number.isInteger(target)
    ? undefined
    : root?.children?.find((item) => item.id === target);

  if (!root || (!Number.isInteger(target) && !child)) {
    throw new Error(`No todo ${target}.`);
  }

  // `root` shows the branch as-is; it needs no row filter at all.
  if (input.scope === "root") return { todos: [root] };

  const visibleIds = input.scope === "children" ? [rootId, target] : [target];

  return { todos: [root], visibleIds };
}

export interface ReadOperationResult {
  /** Scope-narrowed list, also what the tool returns as structured output. */
  todos: TodoRootItem[];
  /** Rows to print for `children`/`item`; absent means "print everything". */
  visibleIds?: readonly number[];
  /** Rendered tree, ready to hand back as tool content. */
  content: string;
}

/**
 * Whole `read` operation, minus storage.
 *
 * Kept pure on purpose: the caller reads the session's list and passes it in,
 * so this module never needs a session id and mirrors `updateTodoById` instead
 * of the storage-facing wrappers.
 */
export function runReadOperation(
  todos: readonly TodoRootItem[],
  input: TodoReadInput,
): ReadOperationResult {
  const scoped = selectReadScope(todos, input);
  const content = formatReadOutput(scoped.todos, {
    visibleIds: scoped.visibleIds,
  });

  return scoped.visibleIds === undefined
    ? { todos: scoped.todos, content }
    : { todos: scoped.todos, visibleIds: scoped.visibleIds, content };
}
