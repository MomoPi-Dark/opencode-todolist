import type { TodoStatus } from "../../schemas/todo/status";

/**
 * The one row shape both the TUI and the GUI flip into view.
 *
 * `note` stays optional on purpose: it is a free-form marker, so a todo without
 * one must keep working exactly like a todo with one. Panels guard on truthiness
 * before rendering it.
 */
export interface TodoRowSource {
  id: number;
  content: string;
  /** Status glyph, resolved by the caller so this module stays icon-agnostic. */
  icon?: string;
  status: TodoStatus;
  depth: number;
  note?: string;
}

export interface TodoRow {
  item: TodoRowSource;
  expandable: boolean;
  collapsed: boolean;
}

/** A `completed` root that still has subtasks starts collapsed. */
export const defaultCollapsed = (
  status: TodoStatus,
  hasChildren: boolean,
): boolean => status === "completed" && hasChildren;

/** A user toggle inverts the default, it does not set an absolute state. */
export const resolveCollapsed = (
  status: TodoStatus,
  hasChildren: boolean,
  manuallyToggled: boolean,
): boolean => {
  const collapsed = defaultCollapsed(status, hasChildren);
  return manuallyToggled ? !collapsed : collapsed;
};

/**
 * Ids of the roots that own at least one subtask.
 *
 * The flat list is ordered root-first (children follow their root), so a single
 * pass is enough: the previous depth-0 id owns every depth-1 id after it.
 */
export function collectParents(
  items: readonly TodoRowSource[],
): ReadonlySet<number> {
  const parents = new Set<number>();
  let root: number | undefined;

  for (const item of items) {
    if (item.depth === 0) root = item.id;
    else if (root !== undefined) parents.add(root);
  }

  return parents;
}

/**
 * Flip the flat item list into renderable rows, dropping the children of every
 * collapsed root.
 */
export function buildTodoRows(
  items: readonly TodoRowSource[],
  toggles: readonly number[],
): TodoRow[] {
  const parents = collectParents(items);
  const rows: TodoRow[] = [];
  let skippedRoot: number | undefined;

  for (const item of items) {
    if (item.depth !== 0) {
      if (skippedRoot !== undefined) continue;
      rows.push({ item, expandable: false, collapsed: false });
      continue;
    }

    const expandable = parents.has(item.id);
    const collapsed = resolveCollapsed(
      item.status,
      expandable,
      toggles.includes(item.id),
    );
    skippedRoot = collapsed && expandable ? item.id : undefined;
    rows.push({ item, expandable, collapsed });
  }

  return rows;
}
