import type { Priority, TodoStatus } from "../schemas/status";
import type {
  TodoChildern,
  TodoRootItem,
  TodoUpdateInput,
} from "../schemas/todo";

type UpdateFields = Omit<TodoUpdateInput, "id">;
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
    throw new Error(
      `[manage_todo_list] todo ${id} cannot move from '${from}' to '${to}'. Progress only moves forward; use 'error' to report a failure and fix it from there.`,
    );
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
  input: TodoUpdateInput,
): { targetRoot: TodoRootItem; target: UpdatableTodo } {
  const targetRoot = todos.find(
    (root) =>
      root.id === input.id ||
      root.children?.some((child) => child.id === input.id),
  );
  if (!targetRoot) {
    throw new Error(`[manage_todo_list] todo id ${input.id} was not found`);
  }

  const firstOpen = todos.findIndex((root) => !isFinal(root.status));
  if (firstOpen === -1) {
    throw new Error(
      "[manage_todo_list] every todo is already finished; nothing can be updated.",
    );
  }

  const targetRootIndex = todos.indexOf(targetRoot);
  if (targetRootIndex !== firstOpen && !hasError(targetRoot)) {
    const blocking = todos[firstOpen]!;
    throw new Error(
      `[manage_todo_list] root ${targetRoot.id} is out of order: finish root ${blocking.id} "${blocking.content}" first (or cancel it). Only a root in 'error' may be fixed early.`,
    );
  }

  const target =
    targetRoot.id === input.id
      ? targetRoot
      : targetRoot.children?.find((child) => child.id === input.id);
  if (!target) {
    throw new Error(`[manage_todo_list] todo id ${input.id} was not found`);
  }

  if (isFinal(target.status)) {
    throw new Error(
      `[manage_todo_list] todo ${input.id} is '${target.status}' and final; it cannot be changed.`,
    );
  }

  assertForwardTransition(target.status, input.status, input.id);

  if (input.status === "in_progress") {
    const running = activeRoot(todos);
    if (running && running.id !== targetRoot.id) {
      throw new Error(
        `[manage_todo_list] root ${running.id} is still in_progress. Finish it (or cancel it) before starting ${targetRoot.id}; an error root may be fixed early only when nothing else is running.`,
      );
    }

    const busyChild = targetRoot.children?.find(
      (child) => child.status === "in_progress" && child.id !== input.id,
    );
    if (busyChild) {
      throw new Error(
        `[manage_todo_list] subtask ${busyChild.id} is still in_progress. Finish it (or cancel it) before starting ${input.id}.`,
      );
    }
  }

  return { targetRoot, target };
}

export function updateTodoById(
  todos: TodoRootItem[],
  input: TodoUpdateInput,
): { todos: TodoRootItem[]; updated: UpdatedTodo } {
  const { targetRoot } = assertSequentialScope(todos, input);
  let updated: UpdatedTodo | undefined;

  const nextTodos = todos.map((root) => {
    if (root.id === input.id) {
      const item = applyUpdate(root, input);
      updated = {
        id: item.id,
        scope: "root",
        content: item.content,
        status: item.status,
      };
      return item;
    }

    if (root.id !== targetRoot.id) return root;

    const children = (root.children ?? []).map((child) => {
      if (child.id !== input.id) return child;
      const item = applyUpdate(child as TodoChildern, input);
      updated = {
        id: item.id,
        scope: "child",
        content: item.content,
        status: item.status,
      };
      return item;
    });

    // A running child implies a running parent. Finished or errored parents
    // keep their status so the order rules stay visible.
    const status =
      input.status === "in_progress" && root.status === "pending"
        ? ("in_progress" as const)
        : root.status;

    return { ...root, status, children };
  });

  if (!updated) {
    throw new Error(`[manage_todo_list] todo id ${input.id} was not found`);
  }

  return { todos: nextTodos, updated };
}
