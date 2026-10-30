import { MAX_CHILDREN, MAX_ROOTS } from "../schemas/todo/fields";
import type {
    TodoChildren,
    TodoList,
    TodoRootItem,
} from "../schemas/todo/item";
import { isOpenStatus, type TodoStatus } from "../schemas/todo/status";

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

/** Any row that renders as one line in the tree, plus where it sits. */
export interface TodoLeaf {
    id: number;
    content: string;
    status: TodoStatus;
    /** 0 for a root, 1 for a subtask. */
    depth: 0 | 1;
    /** Id of the root this row belongs to; a root is its own. */
    rootId: number;
    note?: string;
}

/** A row located by id, together with its root and its parent when it has one. */
export interface TodoLocation {
    item: TodoRootItem | TodoChildren;
    depth: 0 | 1;
    root: TodoRootItem;
    parent?: TodoRootItem;
}

/** Anything rendered as one line (root or child). */
interface TodoLine {
    id: number;
    content: string;
    status: TodoStatus;
    note?: string;
}

/**
 * A todo list (roots + subtasks) with validation, statistics and rendering.
 *
 * Every rule that needs the whole list lives here — duplicate ids, id prefixes,
 * how many items may run at once, parent/child consistency and the order
 * between roots — so the storage layer, the legacy importer and the `update`
 * handler all answer to one implementation.
 *
 * Stateless by design: the list is a parameter on every call, never a field, so
 * there is nothing to construct and no stale copy to keep in sync. Callers keep
 * the rows and ask for answers, which also keeps every method trivially pure —
 * the same list always produces the same result, and nothing is mutated.
 */
export class TodoTree {
    private static readonly STATUS_ICONS: Record<TodoStatus, string> = {
        pending: "[ ]",
        in_progress: "[~]",
        completed: "[x]",
        cancelled: "[-]",
        error: "[!]",
    };

    private static readonly DEFAULT_ICON = this.STATUS_ICONS["pending"];

    /** @internal Not constructible: every method takes the list it works on. */
    private constructor() { }

    // Status & progress helpers

    static isOpenStatus(status: TodoStatus): boolean {
        return isOpenStatus(status);
    }

    /** Completed/total over the subtasks of one root, `null` when it has none. */
    static calculateProgress(
        children?: readonly TodoChildren[],
    ): TodoProgress | null {
        if (!children || children.length === 0) return null;

        const counted = TodoTree.nonCancelled(children);
        // Every subtask was cancelled, so none of them is a unit of work. A
        // `0/0` label would be a number that can never move, and it would
        // disagree with `leaves()`, which counts the root itself in this case.
        if (counted.length === 0) return null;

        const completed = counted.filter(
            (child) => child.status === "completed",
        ).length;
        const total = counted.length;
        return { completed, total, label: `${completed}/${total}` };
    }

    /**
     * Display prefix for an id. Roots render as `1. `, subtasks as `1.1 `
     * (no trailing dot: the id already carries its own separator).
     */
    static formatIdPrefix(id: number, depth: number): string {
        return depth > 0 ? `${id} ` : `${id}. `;
    }

    private static nonCancelled<T extends { status: TodoStatus }>(
        items: readonly T[],
    ): T[] {
        return items.filter((item) => item.status !== "cancelled");
    }

    /** True when the content already opens with its own id, so it is not repeated. */
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

    // Lookup

    /** Finds a root (`1`) or a subtask (`1.1`); `null` when it is not stored. */
    static find(todos: TodoList, id: number): TodoLocation | null {
        const rootId = Number.isInteger(id) ? id : Math.floor(id);

        for (const root of todos) {
            if (root.id === rootId && Number.isInteger(id)) {
                return { item: root, depth: 0, root };
            }
            for (const child of root.children ?? []) {
                if (child.id === id) {
                    return { item: child, depth: 1, root, parent: root };
                }
            }
        }

        return null;
    }

    /**
     * The status a root shows.
     *
     * A root that owns subtasks is a container: it has no status of its own, so
     * one is derived from the children. Any open child keeps the container open;
     * one running child makes it running; only when every child is finished does
     * the container finish. A root without children owns its status outright.
     *
     * Cancelled children are not work, so they are ignored — a container whose
     * remaining children are all done is done.
     */
    static deriveRootStatus(
        root: TodoRootItem,
        children: readonly TodoChildren[] = root.children ?? [],
    ): TodoStatus {
        if (children.length === 0) return root.status;

        // An explicitly cancelled container is final. A leftover child must not
        // resurrect a plan the user already dropped.
        if (root.status === "cancelled") return "cancelled";

        const active = children.filter((child) => child.status !== "cancelled");

        // Every child cancelled: the container is cancelled too, otherwise it
        // would stay open forever and the list could never be cleared.
        if (active.length === 0) return "cancelled";

        if (active.some((child) => child.status === "in_progress"))
            return "in_progress";
        if (active.some((child) => child.status === "error")) return "error";
        if (active.some((child) => isOpenStatus(child.status))) return "pending";

        // Every remaining child finished. A completed child locks the container
        // completed; work that is only cancelled does not.
        if (active.every((child) => child.status === "completed"))
            return "completed";

        return root.status;
    }

    /**
     * Every row that actually holds work: subtasks when a root has them,
     * otherwise the root itself. Cancelled rows are not work and are dropped.
     *
     * This is the unit the TUI, `hint` and the `N/M` progress counter agree on.
     */
    static leaves(todos: TodoList): TodoLeaf[] {
        const leaves: TodoLeaf[] = [];

        for (const root of todos) {
            const children = TodoTree.nonCancelled(root.children ?? []);

            if (children.length === 0) {
                if (root.status === "cancelled") continue;
                leaves.push({
                    id: root.id,
                    content: root.content,
                    status: root.status,
                    depth: 0,
                    rootId: root.id,
                    ...(root.note ? { note: root.note } : {}),
                });
                continue;
            }
            for (const child of children) {
                leaves.push({
                    id: child.id,
                    content: child.content,
                    status: child.status,
                    depth: 1,
                    rootId: root.id,
                    ...(child.note ? { note: child.note } : {}),
                });
            }
        }

        return leaves;
    }

    /** Leaves still holding work: pending, in progress or errored, in list order. */
    static openLeaves(todos: TodoList): TodoLeaf[] {
        return TodoTree.leaves(todos).filter((leaf) => isOpenStatus(leaf.status));
    }

    /** True while any row — root or subtask — is still open. */
    static hasOpen(todos: readonly TodoRootItem[]): boolean {
        return todos.some(
            (root) =>
                // A container is open only while its children are open; the
                // stored root status is stale by design.
                isOpenStatus(TodoTree.deriveRootStatus(root)) ||
                (root.children ?? []).some((child) => isOpenStatus(child.status)),
        );
    }

    // Statistics

    static calculateStats(todos: TodoList): TodoStats {
        const totalSteps = todos.length;
        const completedSteps = todos.filter(
            (root) => TodoTree.deriveRootStatus(root) === "completed",
        ).length;

        const leaves = TodoTree.leaves(todos);
        const totalSubTasks = leaves.length;
        const completedSubTasks = leaves.filter(
            (leaf) => leaf.status === "completed",
        ).length;

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

    /**
     * Validates the structure and repairs what can be repaired (a root whose
     * subtasks all finished is raised to `completed`).
     *
     * A list that fails validation is still rendered by `render` — showing the
     * rows beats refusing — but the caller is expected to see the error first.
     */
    static validateAndNormalize(todos: TodoList): TodoValidationResult {
        const error = TodoTree.validateStructure(todos);
        if (error) return { valid: false, error };
        return TodoTree.normalize(todos);
    }

    /**
     * Returns an error message, or `null` when the structure is valid.
     *
     * Private on purpose: it skips `normalize()`, so it would answer "valid"
     * for a list the order rule still rejects. Callers get one answer, from
     * `validateAndNormalize()`.
     */
    private static validateStructure(todos: TodoList): string | null {
        if (todos.length > MAX_ROOTS) {
            return `At most ${MAX_ROOTS} root todos per list; group related work into subtasks.`;
        }

        const seenIds = new Set<number>();
        const activeRoots: number[] = [];

        for (const root of todos) {
            if (seenIds.has(root.id)) return TodoTree.duplicateIdError(root.id);
            seenIds.add(root.id);
            if (root.status === "in_progress") activeRoots.push(root.id);

            const children = root.children ?? [];
            if (children.length > MAX_CHILDREN) {
                return `Task '${root.id}' has ${children.length} subtasks. At most ${MAX_CHILDREN} are allowed; split the work into another root.`;
            }

            const activeChildren: number[] = [];
            for (const child of children) {
                if (seenIds.has(child.id)) {
                    return TodoTree.duplicateIdError(child.id);
                }
                seenIds.add(child.id);

                if (Math.floor(child.id) !== root.id) {
                    return `Subtask id ${child.id} must start with ${root.id}. (e.g. ${root.id}.1)`;
                }
                if (child.status === "in_progress") activeChildren.push(child.id);
            }

            if (activeChildren.length > 1) {
                return `Task '${root.id}' has ${activeChildren.length} subtasks 'in_progress'. At most 1 is allowed.`;
            }
        }

        if (activeRoots.length > 1) {
            return `Only 1 top-level task can be 'in_progress'. Found: ${activeRoots.join(", ")}.`;
        }

        return null;
    }

    /**
     * Rejects completed parents with unfinished children, and auto-completes a
     * parent whose children are all completed.
     *
     * The order check runs **after** the auto-complete below, never before: a
     * parent whose children all finished is raised to `completed` here, and that
     * promotion can itself create an out-of-order list. Checking first would let
     * the promotion slip past the check.
     */
    private static normalize(todos: TodoList): TodoValidationResult {
        const normalized: TodoRootItem[] = [];

        for (const root of todos) {
            const children = root.children;
            if (!children || children.length === 0) {
                normalized.push(root);
                continue;
            }

            // A root with subtasks is a container: its status is not the
            // caller's to set, it is read from the children.
            normalized.push({
                ...root,
                status: TodoTree.deriveRootStatus(root, children),
            });
        }

        const orderError = TodoTree.findOrderError(normalized);
        if (orderError) return { valid: false, error: orderError };

        return { valid: true, data: normalized };
    }

    /**
     * Roots run in order, so nothing after the first unfinished root may be
     * finished.
     *
     * Only `error` is allowed to follow an open root — a broken task has to be
     * fixable even while earlier work is still open. Everything else
     * (`completed`, `in_progress`, `cancelled`) has to wait its turn.
     *
     * This lives here rather than in the update handler because a `create` and
     * the legacy importer reach the database without passing the update rules at
     * all. One check in the shared validator closes every path at once.
     */
    private static findOrderError(todos: TodoList): string | null {
        const isFinal = (status: TodoStatus) =>
            status === "completed" || status === "cancelled";

        let firstOpen: TodoRootItem | undefined;
        for (const root of todos) {
            // Containers follow their children, so order is decided by the
            // derived status; the stored one is stale by design.
            const status = TodoTree.deriveRootStatus(root);

            if (!firstOpen) {
                if (!isFinal(status)) firstOpen = root;
                continue;
            }

            // Past the first open root: a later root must still be untouched.
            if (status === "pending" || status === "error") continue;

            return `Task '${root.id}' is '${status}' but earlier task '${firstOpen.id}' is still '${TodoTree.deriveRootStatus(firstOpen)}'. Roots run in order: finish or cancel '${firstOpen.id}' first.`;
        }

        return null;
    }

    // Rendering

    /**
     * Renders the tree.
     *
     * `options.visibleIds` narrows which rows are *printed* without touching the
     * data, so a root keeps its real `(completed/total)` label even when only one
     * subtask is listed. A scoped read needs exactly that: the root line shows
     * `(2/2)` while a single subtask row is displayed.
     *
     * A root line is printed only when its own id is visible; a subtask line only
     * when the subtask's id is visible. Omitting `visibleIds` prints everything.
     */
    static render(
        todos: TodoList,
        options?: { visibleIds?: readonly number[] },
    ): string {
        const lines: string[] = [];
        const visible =
            options?.visibleIds === undefined
                ? undefined
                : new Set(options.visibleIds);

        for (const root of todos) {
            const progress = TodoTree.calculateProgress(root.children);
            const progressText = progress ? ` (${progress.label})` : "";
            const hasChildError = (root.children ?? []).some(
                (child) => child.status === "error",
            );

            if (!visible || visible.has(root.id)) {
                lines.push(
                    `${TodoTree.rootIcon(root, hasChildError)} ${TodoTree.renderLabel(root, 0)}${progressText}`,
                );
                if (root.note) lines.push(`    ↳ note: ${root.note}`);
            }

            for (const child of root.children ?? []) {
                if (visible && !visible.has(child.id)) continue;
                lines.push(
                    `    ${TodoTree.icon(child.status)} ${TodoTree.renderLabel(child, 1)}`,
                );
                if (child.note) lines.push(`        ↳ note: ${child.note}`);
            }
        }

        return lines.join("\n");
    }

    /**
     * Compact one-line-per-completed-row summary, for handoff notes and
     * `format: "summary"` reads. Subtask ids keep their root prefix, so the
     * summary stays unambiguous when copied out of the tree.
     */
    public static renderSummary(
        todos: TodoList,
        options?: { visibleIds?: readonly number[] },
    ): string {
        const visible =
            options?.visibleIds === undefined
                ? undefined
                : new Set(options.visibleIds);
        const lines: string[] = [];

        const push = (line: TodoLine) => {
            if (line.status !== "completed") return;
            if (visible && !visible.has(line.id)) return;
            lines.push(
                `- [x] ${line.id} ${line.content}${line.note ? `: ${line.note}` : ""}`,
            );
        };

        for (const root of todos) {
            push(root);
            for (const child of root.children ?? []) push(child);
        }

        return lines.length > 0 ? lines.join("\n") : "No completed tasks yet.";
    }

    private static icon(status: TodoStatus): string {
        return TodoTree.STATUS_ICONS[status] ?? TodoTree.DEFAULT_ICON;
    }

    private static rootIcon(root: TodoRootItem, hasChildError: boolean): string {
        // A failed or cancelled child marks the container without destroying
        // its siblings: the icon reports the problem, the rows stay intact.
        const derived = TodoTree.deriveRootStatus(root);
        if (hasChildError || derived === "error" || derived === "cancelled")
            return "[!]";
        return TodoTree.icon(derived);
    }

    /**
     * Content with strike-through when completed, prefixed with its id unless
     * the content already starts with it.
     */
    private static renderLabel(item: TodoLine, depth: number): string {
        const content =
            item.status === "completed" ? `~~${item.content}~~` : item.content;
        return TodoTree.contentIncludesId(item.content, item.id)
            ? content
            : `${TodoTree.formatIdPrefix(item.id, depth)}${content}`;
    }
}
