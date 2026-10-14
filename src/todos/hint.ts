import { readTodoData, takeHintRevision, TodoStore } from "../storage/todo-store";
import type { TodoChildren, TodoRootItem } from "../schemas/todo";
import type { TodoStatus } from "../schemas/status";
import { TodoTree } from "./todo-tree";

export const DEFAULT_STALE_MS = 30 * 60 * 1000; // 30 minutes (prompt fallback)
export const CONTEXT_STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
const UPCOMING_LIMIT = 3;

export const TODO_HINT =
  "<todo_hint>Active todos exist. If continuing previous work, call " +
  "manage_todo_list [read] first. Ignore if the user is discussing something else.</todo_hint>";

function isOpen(status: TodoStatus): boolean {
  return TodoTree.isOpenStatus(status);
}

function isTaskActive(task: {
  status: TodoStatus;
  children?: Array<{ status: TodoStatus }>;
}): boolean {
  if (isOpen(task.status)) return true;
  return !!task.children && task.children.some((c) => isOpen(c.status));
}

export function isAnyTodoActive(todos: readonly TodoRootItem[]): boolean {
  return todos.some(isTaskActive);
}

export interface ConsumeTodoHintOptions {
  staleMs?: number;
  now?: number;
}

/**
 * Returns the resume hint at most once per stored revision.
 *
 * The "already hinted" marker used to be a `hint-marker.json` file next to the
 * todo payload. It now lives in `todo_session.hint_revision`, so the decision is
 * a single row and cannot drift from the data it describes.
 *
 * The hint is suppressed when the list has no open item, or when the stored
 * write is older than `staleMs` — a resumed session should not be told about
 * work the user abandoned long ago.
 */
export function consumeTodoHint(
  sessionID: string,
  options?: ConsumeTodoHintOptions,
): string | undefined {
  try {
    if (!sessionID) return undefined;
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);

    const state = readTodoData(safeSessionID);
    if (!state) return undefined;

    const todos = state.todos;
    if (todos.length === 0 || !isAnyTodoActive(todos)) return undefined;

    const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
    const now = options?.now ?? Date.now();
    const updatedAt = Date.parse(state.updated_at);
    if (Number.isFinite(updatedAt) && now - updatedAt > staleMs) {
      return undefined;
    }

    // Atomic: reads the previous marker and records this revision in one step,
    // so two rapid calls cannot both emit the hint.
    const previous = takeHintRevision(safeSessionID, state.version);
    if (previous === state.version) return undefined;

    return TODO_HINT;
  } catch {
    return undefined;
  }
}

type Leaf = TodoRootItem | TodoChildren;

export function flattenLeaves(todos: readonly TodoRootItem[]): Leaf[] {
  return todos.flatMap((t) => (t.children?.length ? t.children : [t]));
}

export function findNextTodo(todos: readonly TodoRootItem[]): Leaf | undefined {
  // Strict order: only the first open root is relevant; later roots wait.
  for (const root of todos) {
    if (root.status === "completed" || root.status === "cancelled") continue;

    const children = root.children ?? [];
    const errorChild = children.find((c) => c.status === "error");
    if (root.status === "error") return root;
    if (errorChild) return errorChild;

    const activeChild = children.find((c) => c.status === "in_progress");
    if (activeChild) return activeChild;
    if (root.status === "in_progress") {
      return children.find((c) => c.status === "pending") ?? root;
    }

    return children.find((c) => c.status === "pending") ?? root;
  }
  return undefined;
}

export function findStuckParent(
  todos: readonly TodoRootItem[],
): TodoRootItem | undefined {
  return todos.find(
    (t) =>
      !!t.children?.length &&
      isOpen(t.status) &&
      !t.children.some((c) => isOpen(c.status)),
  );
}

function renderCompactHint(todos: readonly TodoRootItem[]): string {
  const leaves = flattenLeaves(todos);
  const done = leaves.filter((t) => t.status === "completed").length;
  const lines = [`Progress ${done}/${leaves.length} completed.`];

  const openRoot = todos.find(
    (root) => root.status !== "completed" && root.status !== "cancelled",
  );
  if (!openRoot) {
    lines.push("Now: nothing is open.");
    return lines.join("\n");
  }

  const children = openRoot.children ?? [];
  const activeChild = children.find((c) => c.status === "in_progress");
  const errorChild = children.find((c) => c.status === "error");
  const nextPendingChild = children.find((c) => c.status === "pending");
  let nowId: number | undefined;

  if (openRoot.status === "error" || errorChild) {
    const bad = openRoot.status === "error" ? openRoot : errorChild!;
    nowId = bad.id;
    lines.push(
      `Now: ${bad.id} ${bad.content} is 'error'. Fix it or mark it cancelled via manage_todo_list [update], then continue.`,
    );
  } else if (activeChild) {
    nowId = activeChild.id;
    lines.push(`Now: ${activeChild.id} ${activeChild.content}`);
  } else if (openRoot.status === "in_progress" && nextPendingChild) {
    nowId = nextPendingChild.id;
    lines.push(
      `Now: root ${openRoot.id} is in_progress. Start subtask ${nextPendingChild.id} "${nextPendingChild.content}" via manage_todo_list [update] and continue.`,
    );
  } else if (openRoot.status === "in_progress" && children.length > 0) {
    nowId = openRoot.id;
    lines.push(
      `Now: all children of ${openRoot.id} are done. Set ${openRoot.id} to completed via manage_todo_list [update].`,
    );
  } else if (openRoot.status === "pending" && nextPendingChild) {
    nowId = nextPendingChild.id;
    lines.push(
      `Now: start root ${openRoot.id} "${openRoot.content}" (or subtask ${nextPendingChild.id}) via manage_todo_list [update] and continue.`,
    );
  } else if (openRoot.status === "pending") {
    nowId = openRoot.id;
    lines.push(
      `Now: start root ${openRoot.id} "${openRoot.content}" via manage_todo_list [update] and continue.`,
    );
  } else {
    nowId = openRoot.id;
    lines.push(
      `Now: resolve ${openRoot.id} ${openRoot.content} via manage_todo_list [update].`,
    );
  }

  // Next: pending items in root order, root by root, skipping the item named above.
  const next: string[] = [];
  for (const root of todos) {
    if (root.status === "completed" || root.status === "cancelled") continue;

    const candidates = root.children?.length
      ? (root.children ?? []).filter((c) => c.status === "pending")
      : root.status === "pending"
        ? [root]
        : [];

    for (const item of candidates) {
      if (item.id === nowId) continue;
      next.push(`${item.id} ${item.content}`);
      if (next.length === UPCOMING_LIMIT) break;
    }
    if (next.length === UPCOMING_LIMIT) break;
  }
  if (next.length > 0) lines.push(`Next: ${next.join("; ")}`);

  return lines.join("\n");
}

export function buildTodoHint(
  sessionID: string,
  options?: ConsumeTodoHintOptions,
): string | undefined {
  try {
    if (!sessionID) return undefined;
    const safeSessionID = TodoStore.normalizeSessionID(sessionID);
    const state = readTodoData(safeSessionID);
    if (!state) return undefined;

    const todos = state.todos;
    if (todos.length === 0 || !isAnyTodoActive(todos)) return undefined;

    const staleMs = options?.staleMs ?? CONTEXT_STALE_MS;
    const now = options?.now ?? Date.now();
    const updatedAt = Date.parse(state.updated_at);
    if (Number.isFinite(updatedAt) && now - updatedAt > staleMs) {
      return undefined;
    }

    return (
      `<todo_state>\n${renderCompactHint(todos)}\n</todo_state>\n` +
      "<todo_rules>Open todos remain. Continue the in_progress item now. " +
      "Progress moves forward only and roots run in order: never reopen a finished item, " +
      "never start a later root while the current one is open. " +
      "Do not end your turn or write a final summary while items are open, " +
      "unless you are blocked or need user input. " +
      "Call manage_todo_list [read] for the full list. " +
      "Change items with manage_todo_list [update]; use [write] only to initialize an empty list or to clear it with []. " +
      "Ignore only if the user clearly changed topic or asked to stop or pause.</todo_rules>"
    );
  } catch {
    return undefined;
  }
}
