import { TodoRootItem } from "../../schemas/todo/item";
import type { TodoStatus } from "../../schemas/todo/status";
import { TodoTree } from "../todotree";

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
    // A root that owns subtasks is a container: it shows the status its
    // children add up to, not whatever was stored on the root.
    const rootStatus = TodoTree.deriveRootStatus(parent);
    items.push({
      id: parent.id,
      content: parent.content,
      icon: getStatusIcon(rootStatus),
      status: rootStatus,
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
