import type { TodoStatus } from "../schema/status.schema";
import type { TodoRootItem } from "../schema/todo.schema";
import { TodoTree } from "./todo";

export interface TodoDisplayItem {
  id: number;
  content: string;
  icon: string;
  status: TodoStatus;
  depth: number;
  /** Technical context/evidence; the TUI reveals it on demand (click). */
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

export function hasOpenTodos(items: TodoDisplayItem[]): boolean {
  return items.some((item) => TodoTree.isOpenStatus(item.status));
}

export function getTodoDisplaySummary(
  todos: TodoRootItem[],
): TodoDisplaySummary | null {
  if (!todos || todos.length === 0) return null;

  const stats = new TodoTree(todos).calculateStats();
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

export function formatTodoProgress(todos: TodoRootItem[]): string | null {
  const summary = getTodoDisplaySummary(todos);
  return summary ? summary.header : null;
}
