import type { Priority, TodoStatus } from "../schemas/status";
import type {
  TodoRootItem,
  TodoUpdateItem
} from "../schemas/todo";

type UpdateFields = Omit<TodoUpdateItem, "id">;
type UpdatableTodo = {
  content: string;
  status: TodoStatus;
  priority?: Priority;
  note?: string;
};

export interface UpdatedTodo {
  id: number;
  scope: "root" | "child";
  content: string;
  status: TodoStatus;
}

const FINAL_STATUSES: readonly TodoStatus[] = ["completed", "cancelled"];

/**
 * Forward-only progress: a status may advance or stay the same, never move
 * backward. `error` is reportable from any open status and fixable back to
 * `in_progress`/`completed`/`cancelled`.
 */
const FORWARD_TRANSITIONS: Record<TodoStatus, readonly TodoStatus[]> = {
  pending: ["in_progress", "completed", "cancelled", "error"],
  in_progress: ["completed", "cancelled", "error"],
  error: ["in_progress", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function isFinal(status: TodoStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

function applyUpdate<T extends UpdatableTodo>(
  item: T,
  changes: UpdateFields,
): T {
  const next = { ...item };

  if (changes.content !== undefined) next.content = changes.content;
  if (changes.status !== undefined) next.status = changes.status;
  if (changes.priority !== undefined) {
    if (changes.priority === null) delete next.priority;
    else next.priority = changes.priority;
  }
  if (changes.note !== undefined) {
    if (changes.note === null) delete next.note;
    else next.note = changes.note;
  }

  return next;
}

function assertForwardTransition(
  from: TodoStatus,
  to: TodoStatus,
  id: number,
): void {
  if (from === to) return;
  if (!(FORWARD_TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error(`${id} is ${from}. Forward-only.`);
  }
}

/** Any root still open, an `error` root included. */
function activeRoot(todos: TodoRootItem[]): TodoRootItem | undefined {
  return todos.find((root) => root.status === "in_progress");
}

function hasError(root: TodoRootItem): boolean {
  return (
    root.status === "error" ||
    root.children?.some((child) => child.status === "error") === true
  );
}

/**
 * Order rules for one update:
 *
 * 1. Forward-only. A status never moves backward, and finished items are locked.
 * 2. Strict order. Only the first unfinished root — and the children inside it —
 *    may change. Every later root waits until the previous ones are completed
 *    or cancelled.
 * 3. Error exception. A root that holds `error` may be fixed early, but only
 *    that root and its own children; nothing else may be touched.
 * 4. Single active root. Starting `in_progress` work is refused while another
 *    root is still `in_progress`, so a started root is finished before the next.
 */
export function assertSequentialScope(
  todos: TodoRootItem[],
  input: TodoUpdateItem,
): { targetRoot: TodoRootItem; target: UpdatableTodo } {
  const targetRoot = todos.find(
    (root) =>
      root.id === input.id ||
      root.children?.some((child) => child.id === input.id),
  );
  if (!targetRoot) {
    throw new Error(`No todo ${input.id}.`);
  }

  const firstOpen = todos.findIndex((root) => !isFinal(root.status));
  if (firstOpen === -1) {
    throw new Error(
      "All todos are final.",
    );
  }

  const targetRootIndex = todos.indexOf(targetRoot);
  if (targetRootIndex !== firstOpen && !hasError(targetRoot)) {
    const blocking = todos[firstOpen]!;
    throw new Error(
      `Root ${blocking.id} open. Finish or cancel it first.`,
    );
  }

  const target =
    targetRoot.id === input.id
      ? targetRoot
      : targetRoot.children?.find((child) => child.id === input.id);
  if (!target) {
    throw new Error(`No todo ${input.id}.`);
  }

  if (isFinal(target.status)) {
    throw new Error(`${input.id} is ${target.status}.`);
  }

  assertForwardTransition(target.status, input.status, input.id);

  if (input.status === "in_progress") {
    const running = activeRoot(todos);
    if (running && running.id !== targetRoot.id) {
      throw new Error(
        `${running.id} is running. Finish it first.`,
      );
    }

    const busyChild = targetRoot.children?.find(
      (child) => child.status === "in_progress" && child.id !== input.id,
    );
    if (busyChild) {
      throw new Error(
        `${busyChild.id} is running. Finish it first.`,
      );
    }
  }

  return { targetRoot, target };
}

export function updateTodoById(
  todos: TodoRootItem[],
  updates: readonly TodoUpdateItem[],
): { todos: TodoRootItem[]; updated: UpdatedTodo[] } {
  let state = todos;
  const updated: UpdatedTodo[] = [];

  // Sequential: each item is validated against the state left by the previous
  // one, not against the original list. That is what makes the pair
  // "1.1 completed, 1.2 in_progress" legal — 1.2 only stops being blocked by a
  // busy child once 1.1 is finished. Validating everything against `todos`
  // instead would reject the second item with "1.1 is running".
  for (const input of updates) {
    const result = applyOne(state, input);
    state = result.todos;
    updated.push(...result.updated);
  }

  return { todos: state, updated };
}

/** Applies one update against the list as it stands right now. */
function applyOne(
  todos: TodoRootItem[],
  input: TodoUpdateItem,
): { todos: TodoRootItem[]; updated: UpdatedTodo[] } {
  const { targetRoot } = assertSequentialScope(todos, input);
  let primaryUpdated: UpdatedTodo | undefined;
  const cancelledTodos: UpdatedTodo[] = [];

  const shouldCancelRemaining =
    input.cancel_remaining === true &&
    (input.status === "error" || input.status === "cancelled");

  const nextTodos = todos.map((root) => {
    if (root.id === input.id) {
      const item = applyUpdate(root, input);
      primaryUpdated = {
        id: item.id,
        scope: "root",
        content: item.content,
        status: item.status,
      };

      if (shouldCancelRemaining && item.children) {
        const children = item.children.map((child) => {
          if (child.status === "pending") {
            cancelledTodos.push({
              id: child.id,
              scope: "child",
              content: child.content,
              status: "cancelled",
            });
            return { ...child, status: "cancelled" as const };
          }
          return child;
        });
        return { ...item, children };
      }

      return item;
    }

    if (root.id !== targetRoot.id) return root;

    const children = (root.children ?? []).map((child) => {
      if (child.id === input.id) {
        const item = applyUpdate(child, input);
        primaryUpdated = {
          id: item.id,
          scope: "child",
          content: item.content,
          status: item.status,
        };
        return item;
      }

      if (shouldCancelRemaining && child.status === "pending") {
        cancelledTodos.push({
          id: child.id,
          scope: "child",
          content: child.content,
          status: "cancelled",
        });
        return { ...child, status: "cancelled" as const };
      }

      return child;
    });

    // A running child implies a running parent. Finished or errored parents
    // keep their status so the order rules stay visible.
    const status =
      input.status === "in_progress" && root.status === "pending"
        ? ("in_progress" as const)
        : root.status;

    return { ...root, status, children };
  });

  if (!primaryUpdated) {
    throw new Error(`No todo ${input.id}.`);
  }

  return { todos: nextTodos, updated: [primaryUpdated, ...cancelledTodos] };
}
