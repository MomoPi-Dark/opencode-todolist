import { TodoRootItem } from "../schemas/todo/item";
import type { TodoStatus } from "../schemas/todo/status";
import { TodoTree } from "./todo-tree";

export interface TodoDisplayItem {
  id: number;
  content: string;
  icon: string;
  status: TodoStatus;
  depth: number;
  note?: string;
}

export interface TodoDisplaySummary {
  header: string;
  completed: number;
  total: number;
  items: TodoDisplayItem[];
}

export function getStatusIcon(status: TodoStatus): string {
  switch (status) {
    case "completed":
      return "✓";
    case "in_progress":
      return "⦿";
    case "error":
      return "!";
    case "cancelled":
      return "✗";
    case "pending":
    default:
      return "○";
  }
}

export function hasOpenTodos(todos: readonly TodoRootItem[]): boolean {
    return TodoTree.hasOpen(todos);
}

export const openTodosError = (action: "create" | "clear"): Error =>
  new Error(
    [
      `Cannot ${action}: the current list still has open todos (pending, in_progress or error).`,
      "",
      'Use "update" to set every open todo to completed or cancelled first.',
      'Use "cancel_remaining" with status cancelled to drop the rest of a root in one step.',
    ].join("\n"),
  );

export function getTodoDisplaySummary(
  todos: TodoRootItem[],
): TodoDisplaySummary | null {
  if (!todos || todos.length === 0) return null;

  const stats = TodoTree.calculateStats(todos);
  const completed = stats.completedSubTasks;
  const total = stats.totalSubTasks;
  const header = `Todos (${completed}/${total})`;
  const items: TodoDisplayItem[] = [];

  for (const parent of todos) {
    items.push({
      id: parent.id,
      content: parent.content,
      icon: getStatusIcon(parent.status),
      status: parent.status,
      depth: 0,
      ...(parent.note ? { note: parent.note } : {}),
    });
    for (const child of parent.children ?? []) {
      items.push({
        id: child.id,
        content: child.content,
        icon: getStatusIcon(child.status),
        status: child.status,
        depth: 1,
        ...(child.note ? { note: child.note } : {}),
      });
    }
  }

  return { header, completed, total, items };
}
