import { OPEN_STATUSES, type TodoStatus } from "../schema/status.schema.js";
import type { TodoChildern, TodoRootItem } from "../schema/todo.schema";

export interface TodoProgress {
  completed: number;
  total: number;
  label: string;
}

export interface TodoStats {
  totalSteps: number;
  completedSteps: number;
  totalSubTasks: number;
  completedSubTasks: number;
  percent: number;
}

export type TodoValidationResult =
  | { valid: true; data: TodoRootItem[] }
  | { valid: false; error: string };

/** Anything that is rendered as one line in the tree (root or child). */
interface TodoLine {
  id: number;
  content: string;
  status: TodoStatus;
}

/**
 * A todo list (roots + children) with validation, statistics and rendering.
 *
 * Instance methods operate on the list passed to the constructor; helpers that
 * do not depend on a list (status checks, progress bar, id formatting) are
 * `static`.
 */
export class TodoTree {
  private static readonly STATUS_ICONS: Record<TodoStatus, string> = {
    pending: "[ ]",
    in_progress: "[~]",
    completed: "[x]",
    cancelled: "[-]",
    error: "[!]",
  };

  private static readonly DEFAULT_ICON = "[ ]";
  private static readonly BAR_FILLED = "█";
  private static readonly BAR_UNFILLED = "░";

  constructor(readonly todos: readonly TodoRootItem[]) { }

  // Static helpers

  static isOpenStatus(status: TodoStatus): boolean {
    return OPEN_STATUSES.includes(status);
  }

  static calculateProgress(
    children?: readonly TodoChildern[],
  ): TodoProgress | null {
    if (!children || children.length === 0) return null;
    const nonCancelled = TodoTree.nonCancelled(children);
    const completed = nonCancelled.filter(
      (c) => c.status === "completed",
    ).length;
    const total = nonCancelled.length;
    return { completed, total, label: `${completed}/${total}` };
  }

  static renderProgressBar(
    percent: number,
    width: number = 10,
  ): { filled: string; unfilled: string } {
    const clamped = Math.max(0, Math.min(100, percent));
    const filledCount = Math.round((clamped / 100) * width);
    const unfilledCount = width - filledCount;

    return {
      filled: TodoTree.BAR_FILLED.repeat(filledCount),
      unfilled: TodoTree.BAR_UNFILLED.repeat(unfilledCount),
    };
  }

  /**
   * Display prefix for an id. Roots render as "1. ", children as "1.1 ".
   * (All ids are numeric now, so every id is a "point id".)
   */
  static formatIdPrefix(id: number, depth: number): string {
    return depth > 0 ? `${id} ` : `${id}. `;
  }

  private static nonCancelled<T extends { status: TodoStatus }>(
    items: readonly T[],
  ): T[] {
    return items.filter((item) => item.status !== "cancelled");
  }

  private static contentIncludesId(content: string, id: number): boolean {
    const key = String(id);
    return (
      content === key ||
      content.startsWith(`${key}. `) ||
      content.startsWith(`${key}: `) ||
      content.startsWith(`${key} `)
    );
  }

  private static duplicateIdError(id: number): string {
    return `Duplicate ID found: '${id}'. Every ID must be unique across the tree.`;
  }

  // Statistics

  public calculateStats(): TodoStats {
    const totalSteps = this.todos.length;
    const completedSteps = this.todos.filter(
      (t) => t.status === "completed",
    ).length;
    let totalSubTasks = 0;
    let completedSubTasks = 0;

    for (const item of this.todos) {
      if (item.children && item.children.length > 0) {
        const nonCancelled = TodoTree.nonCancelled(item.children);
        totalSubTasks += nonCancelled.length;
        completedSubTasks += nonCancelled.filter(
          (c) => c.status === "completed",
        ).length;
      } else if (item.status !== "cancelled") {
        // A root without children counts as a single unit of work.
        totalSubTasks += 1;
        if (item.status === "completed") completedSubTasks += 1;
      }
    }

    const percent =
      totalSubTasks > 0
        ? Math.round((completedSubTasks / totalSubTasks) * 100)
        : 0;

    return {
      totalSteps,
      completedSteps,
      totalSubTasks,
      completedSubTasks,
      percent,
    };
  }

  // Validation

  public validateAndNormalize(): TodoValidationResult {
    const error = this.validateStructure();
    if (error) return { valid: false, error };
    return this.normalize();
  }

  /** Returns an error message, or null when the structure is valid. */
  private validateStructure(): string | null {
    const seenIds = new Set<number>();
    const activeParents: number[] = [];

    for (const parent of this.todos) {
      if (seenIds.has(parent.id)) return TodoTree.duplicateIdError(parent.id);
      seenIds.add(parent.id);
      if (parent.status === "in_progress") activeParents.push(parent.id);

      const activeChildren: number[] = [];
      for (const child of parent.children ?? []) {
        if (seenIds.has(child.id)) return TodoTree.duplicateIdError(child.id);
        seenIds.add(child.id);
        if (child.status === "in_progress") activeChildren.push(child.id);
      }

      if (activeChildren.length > 1) {
        return `Task '${parent.id}' has ${activeChildren.length} subtasks 'in_progress'. At most 1 is allowed.`;
      }

      if (activeChildren.length === 1 && parent.status !== "in_progress") {
        return `Subtask '${activeChildren[0]}' is 'in_progress' but parent '${parent.id}' is '${parent.status}'. Set parent to 'in_progress' first.`;
      }
    }

    if (activeParents.length > 1) {
      return `Only 1 top-level task can be 'in_progress'. Found: ${activeParents.join(", ")}.`;
    }

    return null;
  }

  /**
   * Rejects completed parents with unfinished children, and auto-completes a
   * parent whose children are all completed.
   */
  private normalize(): TodoValidationResult {
    const normalized: TodoRootItem[] = [];

    for (const item of this.todos) {
      const children = item.children;
      if (!children || children.length === 0) {
        normalized.push(item);
        continue;
      }

      const hasUnfinishedChildren = children.some(
        (c) =>
          c.status === "pending" ||
          c.status === "in_progress" ||
          c.status === "error",
      );

      if (item.status === "completed" && hasUnfinishedChildren) {
        return {
          valid: false,
          error: `Task '${item.id}' cannot be marked 'completed' while it still has pending, in-progress or errored subtasks.`,
        };
      }

      const allChildrenCompleted = children.every(
        (c) => c.status === "completed",
      );
      normalized.push({
        ...item,
        status: allChildrenCompleted ? "completed" : item.status,
      });
    }

    return { valid: true, data: normalized };
  }

  // Rendering

  public render(): string {
    const lines: string[] = [];

    for (const parent of this.todos) {
      const progress = TodoTree.calculateProgress(parent.children);
      const progressText = progress ? ` (${progress.label})` : "";
      lines.push(
        `${TodoTree.icon(parent.status)} ${TodoTree.renderLabel(parent, 0)}${progressText}`,
      );
      if (parent.note) lines.push(`    ↳ note: ${parent.note}`);

      for (const child of parent.children ?? []) {
        lines.push(
          `    ${TodoTree.icon(child.status)} ${TodoTree.renderLabel(child, 1)}`,
        );
        if (child.note) lines.push(`        ↳ note: ${child.note}`);
      }
    }

    return lines.join("\n");
  }

  private static icon(status: TodoStatus): string {
    return TodoTree.STATUS_ICONS[status] ?? TodoTree.DEFAULT_ICON;
  }

  /** Content with strike-through when completed, prefixed with its id unless it already starts with it. */
  private static renderLabel(item: TodoLine, depth: number): string {
    const content =
      item.status === "completed" ? `~~${item.content}~~` : item.content;
    return TodoTree.contentIncludesId(item.content, item.id)
      ? content
      : `${TodoTree.formatIdPrefix(item.id, depth)}${content}`;
  }
}
