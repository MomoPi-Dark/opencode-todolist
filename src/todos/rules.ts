import type {
    TodoChildren,
    TodoList,
    TodoRootItem,
} from "../schemas/todo/item";
import type { Priority, TodoStatus } from "../schemas/todo/status";
import type { TodoUpdateItem } from "../schemas/todo/update";
import { TodoTree, type TodoLocation } from "./todo-tree";

/**
 * Every way an update can be refused. Stable identifiers so callers and tests
 * never depend on message wording.
 */
export type TodoRuleCode =
    | "not_found"
    | "list_final"
    | "root_out_of_order"
    | "item_final"
    | "backward_transition"
    | "root_busy"
    | "child_busy"
    | "child_open"
    | "cancel_remaining_status"
    | "list_invalid";

export interface TodoRuleError {
    code: TodoRuleCode;
    /** Ready to hand back to the model: says what is wrong and what to do. */
    message: string;
    /** The row the error is about, when it is about one row. */
    id?: number;
}

/** One row as it stands after the update; what the tool reports back. */
export interface TodoUpdatedRow {
    id: number;
    scope: "root" | "child";
    content: string;
    status: TodoStatus;
}

export type TodoApplyResult =
    | { ok: true; todos: TodoRootItem[]; updated: TodoUpdatedRow[] }
    | {
        ok: false;
        error: TodoRuleError; /**
       * Index in the batch that failed. The batch is atomic, so nothing was
       * applied: the caller starts again from its own copy.
       */
        index: number;
    };

const fail = (
    code: TodoRuleCode,
    message: string,
    id?: number,
): TodoRuleError => ({ code, message, ...(id === undefined ? {} : { id }) });

const isFinal = (status: TodoStatus): boolean =>
    status === "completed" || status === "cancelled";

/**
 * The rules a zod schema cannot express.
 *
 * A schema sees one payload and nothing else. It cannot know that `1.1` is
 * already `completed` (so it is locked), that root `2` sits behind an open root
 * `1`, or that another subtask is already running. Those judgements need the
 * list *before* the change and the change itself, which is exactly what this
 * module takes.
 *
 * Stateless like `TodoTree`: the list is a parameter, nothing is stored, and
 * nothing is mutated. `TodoTree` answers "is this list well formed?"; `TodoRules`
 * answers "may this list become that one?".
 *
 * Layering: scope and transition are checked here first so the refusal names the
 * real cause ("1.1 is completed"), then the resulting list goes through
 * `TodoTree.validateAndNormalize` as a second net for the whole-list invariants
 * (order between roots, auto-completion, parent/child consistency).
 */
export class TodoRules {
    private constructor() { }

    // Status transitions

    /**
     * Forward-only: a status may advance or stay put, never move back.
     *
     * `completed` and `cancelled` are final and locked. `error` may be repaired
     * to `in_progress`, `completed` or `cancelled`, but not rewound to
     * `pending` — the work was started, so it cannot pretend it never was.
     */
    private static readonly TRANSITIONS: Record<
        TodoStatus,
        readonly TodoStatus[]
    > = {
            pending: ["in_progress", "completed", "cancelled", "error"],
            in_progress: ["completed", "cancelled", "error"],
            error: ["in_progress", "completed", "cancelled"],
            completed: [],
            cancelled: ["in_progress"],
        };

    static isFinal(status: TodoStatus): boolean {
        return isFinal(status);
    }

    /** True when `to` is reachable from `from`, same status included. */
    static canTransition(from: TodoStatus, to: TodoStatus): boolean {
        if (from === to) return true;
        return (TodoRules.TRANSITIONS[from] ?? []).includes(to);
    }

    static checkTransition(
        from: TodoStatus,
        to: TodoStatus,
        id: number,
    ): TodoRuleError | null {
        if (TodoRules.canTransition(from, to)) return null;

        if (isFinal(from)) {
            return fail(
                "item_final",
                `${id} is already '${from}' and locked. Only a pending, in-progress or errored todo can change status.`,
                id,
            );
        }

        return fail(
            "backward_transition",
            `${id} cannot go from '${from}' to '${to}'. Progress moves forward only.`,
            id,
        );
    }

    // Scope

    /**
     * Which row the update is aimed at, or a `not_found` error.
     *
     * Exposed so a caller can resolve an id once and reuse the answer instead of
     * scanning the list twice.
     */
    static locate(todos: TodoList, id: number): TodoLocation | TodoRuleError {
        const found = TodoTree.find(todos, id);
        return found ?? fail("not_found", `No todo ${id}.`, id);
    }

    /**
     * May this row be touched right now?
     *
     * Four rules, in the order the model needs to hear them:
     *
     * 1. **Locked rows.** A completed or cancelled row cannot be edited — that
     *    is the most precise reason, so it wins over the order rule.
     * 2. **Nothing left to do.** Every root is already closed, so the list is
     *    over even if a closed root still holds an open subtask.
     * 3. **Order.** Only the first unfinished root, and its own subtasks, may
     *    change — with one exception: a root holding `error` is fixable early,
     *    because a broken step must not be blocked by earlier work.
     * 4. **One active chain.** No second `in_progress` root, and no second
     *    `in_progress` subtask inside the same root.
     */
    static checkScope(
        todos: TodoList,
        location: TodoLocation,
        update: Pick<TodoUpdateItem, "id" | "status" | "cancel_remaining">,
    ): TodoRuleError | null {
        const id = update.id;

        if (isFinal(location.item.status) && location.item.status !== "cancelled") {
            return fail(
                "item_final",
                `${id} is '${location.item.status}' and locked. Reopen it by creating a new todo instead.`,
                id,
            );
        }

        if (
            location.depth === 0 &&
            update.status !== undefined &&
            (location.root.children ?? []).some((child) => !isFinal(child.status)) &&
            update.cancel_remaining !== true
        ) {
            return fail(
                "child_open",
                `Root ${id} has open children. Finish or cancel every child before changing the root status.`,
                id,
            );
        }

        const firstOpenIndex = todos.findIndex((root) => !isFinal(root.status));

        // Reachable only from a stored list where a closed root still holds an
        // open subtask: every root is final, so the work belongs to a task that
        // was already dropped or finished. Editing it would resurrect that root.
        if (firstOpenIndex === -1 && !(location.item.status === "cancelled" && update.status === "in_progress")) {
            return fail(
                "list_final",
                "Every root is already completed or cancelled, so there is nothing left to update. Create a new todo instead.",
                id,
            );
        }

        const targetRootIndex = todos.indexOf(location.root);
        if (
            targetRootIndex !== firstOpenIndex &&
            !(location.item.status === "cancelled" && update.status === "in_progress") &&
            !TodoRules.holdsError(location.root)
        ) {
            const blocking = todos[firstOpenIndex];
            return fail(
                "root_out_of_order",
                `Root ${blocking?.id} is still open. Roots run in order: finish or cancel ${blocking?.id} before touching ${id}.`,
                id,
            );
        }

        if (update.status !== undefined) {
            const transition = TodoRules.checkTransition(
                location.item.status,
                update.status,
                id,
            );
            if (transition) return transition;
        }

        if (update.status === "in_progress") {
            const busyRoot = todos.find(
                (root) => root.status === "in_progress" && root.id !== location.root.id,
            );
            if (busyRoot) {
                return fail(
                    "root_busy",
                    `Root ${busyRoot.id} is already in progress. Finish or cancel it before starting ${id}.`,
                    id,
                );
            }

            const busyChild = (location.root.children ?? []).find(
                (child) =>
                    child.status === "in_progress" && child.id !== location.item.id,
            );
            if (busyChild) {
                return fail(
                    "child_busy",
                    `Subtask ${busyChild.id} is already in progress. Finish or cancel it before starting ${id}.`,
                    id,
                );
            }
        }

        return null;
    }

    /** A root is fixable early when it, or one of its subtasks, holds `error`. */
    private static holdsError(root: TodoRootItem): boolean {
        return (
            root.status === "error" ||
            (root.children ?? []).some((child) => child.status === "error")
        );
    }

    // Applying

    /**
     * Applies a batch of updates in order, atomically.
     *
     * Each step is validated against the list the previous step left behind —
     * not against the original. That is what makes the pair "1.1 completed, then
     * 1.2 in_progress" legal: 1.2 only stops being blocked by a running sibling
     * once 1.1 is finished. Validating the whole batch against the original list
     * would refuse the second step.
     *
     * If any step fails, nothing is returned as data: the caller keeps its own
     * copy and the error points at the offending `index`.
     */
    static apply(
        todos: TodoList,
        updates: readonly TodoUpdateItem[],
    ): TodoApplyResult {
        let state: TodoRootItem[] = [...todos];
        const updated: TodoUpdatedRow[] = [];

        for (const [index, update] of updates.entries()) {
            const step = TodoRules.applyOne(state, update);
            if (!step.ok) return { ok: false, error: step.error, index };
            state = step.todos;
            updated.push(...step.updated);
        }

        return { ok: true, todos: state, updated };
    }

    /** Applies one update against the list as it stands right now. */
    static applyOne(
        todos: TodoList,
        update: TodoUpdateItem,
    ):
        | { ok: true; todos: TodoRootItem[]; updated: TodoUpdatedRow[] }
        | {
            ok: false;
            error: TodoRuleError;
        } {
        const found = TodoRules.locate(todos, update.id);
        if ("code" in found) return { ok: false, error: found };

        const scopeError = TodoRules.checkScope(todos, found, update);
        if (scopeError) return { ok: false, error: scopeError };

        const cancelRemaining = update.cancel_remaining === true;
        if (
            cancelRemaining &&
            update.status !== "error" &&
            update.status !== "cancelled"
        ) {
            return {
                ok: false,
                error: fail(
                    "cancel_remaining_status",
                    `cancel_remaining needs status 'error' or 'cancelled', not '${update.status ?? "unchanged"}'.`,
                    update.id,
                ),
            };
        }

        const report: TodoUpdatedRow[] = [];

        const next = todos.map((root) => {
            if (root.id !== found.root.id) return root;

            if (found.depth === 0) {
                return TodoRules.patchRoot(root, update, cancelRemaining, report);
            }

            return TodoRules.patchChild(root, update, cancelRemaining, report);
        });

        // Second net: the whole-list invariants — order between roots, parent and
        // child consistency, auto-completion — live in `TodoTree`, so the result
        // is checked by the same implementation everything else uses.
        const check = TodoTree.validateAndNormalize(next);
        if (!check.valid) {
            return {
                ok: false,
                error: fail("list_invalid", check.error, update.id),
            };
        }

        return { ok: true, todos: check.data, updated: report };
    }

    private static patchRoot(
        root: TodoRootItem,
        update: TodoUpdateItem,
        cancelRemaining: boolean,
        report: TodoUpdatedRow[],
    ): TodoRootItem {
        const patched = TodoRules.patch(root, update);
        report.push({
            id: patched.id,
            scope: "root",
            content: patched.content,
            status: patched.status,
        });

        const cancelChildren =
            cancelRemaining ||
            patched.status === "error" ||
            patched.status === "cancelled";
        if (!cancelChildren || !patched.children) return patched;

        const children = patched.children.map((child) => {
            if (child.status !== "pending" && child.status !== "in_progress") {
                return child;
            }
            report.push({
                id: child.id,
                scope: "child",
                content: child.content,
                status: "cancelled",
            });
            return { ...child, status: "cancelled" as const };
        });

        return { ...patched, children };
    }

    private static patchChild(
        root: TodoRootItem,
        update: TodoUpdateItem,
        cancelRemaining: boolean,
        report: TodoUpdatedRow[],
    ): TodoRootItem {
        const children: TodoChildren[] = (root.children ?? []).map((child) => {
            if (child.id === update.id) {
                const patched = TodoRules.patch(child, update);
                report.push({
                    id: patched.id,
                    scope: "child",
                    content: patched.content,
                    status: patched.status,
                });
                return patched;
            }

            if (cancelRemaining && child.status === "pending") {
                report.push({
                    id: child.id,
                    scope: "child",
                    content: child.content,
                    status: "cancelled",
                });
                return { ...child, status: "cancelled" as const };
            }

            return child;
        });

        // A running subtask needs a running parent, so a `pending` (or broken)
        // root is brought along. Nothing else is promoted here: a finished or
        // errored root keeps its status so the order rules stay visible.
        const status =
            update.status === "in_progress" &&
                (root.status === "pending" || root.status === "error")
                ? ("in_progress" as const)
                : root.status;

        return { ...root, status, children };
    }

    /**
     * Copies the row with the update applied. `null` removes `priority` or
     * `note`; `undefined` keeps the old value.
     */
    private static patch<
        T extends {
            content: string;
            status: TodoStatus;
            priority?: Priority;
            note?: string;
        },
    >(item: T, update: TodoUpdateItem): T {
        const next = { ...item } as T & {
            priority?: Priority;
            note?: string;
        };

        if (update.content !== undefined) next.content = update.content;
        if (update.status !== undefined) next.status = update.status;

        if (update.priority !== undefined) {
            if (update.priority === null) delete next.priority;
            else next.priority = update.priority;
        }

        if (update.note !== undefined) {
            if (update.note === null) delete next.note;
            else next.note = update.note;
        }

        if (item.status === "cancelled" && update.status === "in_progress") {
            next.note = next.note
                ? `${next.note}; Reopened from cancelled`
                : "Reopened from cancelled";
        }

        return next as T;
    }
}
