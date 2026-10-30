import { TodoRootItem } from "../../schemas/todo/item";
import { TodoTree } from "../todotree";
import {
    findNextTodo,
    findStuckParent,
    flattenLeaves,
    isAnyTodoActive,
} from "./hint";

const STATUS_MARK = {
    completed: "✓\uFE0E",
    in_progress: "▶\uFE0E",
    error: "✗\uFE0E",
    cancelled: "⊘\uFE0E",
} as const;

/**
 * Status changes produced by one call.
 *
 * `changedIds` is returned alongside the rendered lines so the caller can avoid
 * naming the same item twice: `Next:` is only worth printing when it points
 * somewhere other than the row that just moved.
 */
interface TransitionSummary {
    readonly lines: string[];
    readonly changedIds: ReadonlySet<number>;
}

export function summarizeTransitions(
    before: readonly TodoRootItem[],
    after: readonly TodoRootItem[],
): TransitionSummary {
    const previous = new Map(
        flattenLeaves(before).map((leaf) => [leaf.id, leaf.status] as const),
    );
    const leaves = flattenLeaves(after);
    const total = leaves.length;
    const lines: string[] = [];
    const changedIds = new Set<number>();

    leaves.forEach((leaf, index) => {
        const was = previous.get(leaf.id);
        if (was === leaf.status) return;
        // A leaf already present at its starting status is not a transition.
        if (was === undefined && leaf.status !== "in_progress") return;

        const label = `${index + 1}/${total}: ${leaf.content}`;
        if (leaf.status === "completed") {
            changedIds.add(leaf.id);
            lines.push(`${STATUS_MARK.completed} ${label}`);
        } else if (leaf.status === "in_progress") {
            changedIds.add(leaf.id);
            lines.push(`${STATUS_MARK.in_progress} ${label}`);
        } else if (leaf.status === "error") {
            changedIds.add(leaf.id);
            lines.push(
                `${STATUS_MARK.error} ${label}${leaf.note ? ` — ${leaf.note}` : ""}`,
            );
        } else if (leaf.status === "cancelled") {
            changedIds.add(leaf.id);
            lines.push(`${STATUS_MARK.cancelled} ${label}`);
        }
    });

    return { lines, changedIds };
}

export function formatWriteOutput(
    todos: readonly TodoRootItem[],
    before: readonly TodoRootItem[] = [],
): string {
    const stats = TodoTree.calculateStats(todos as TodoRootItem[]);
    const base = `Todos (${stats.completedSubTasks}/${stats.totalSubTasks}).`;
    const next = findNextTodo(todos);
    const stuck = findStuckParent(todos);
    const { lines, changedIds } = summarizeTransitions(before, todos);

    // Only name the next step when it is not the row that just moved: repeating
    // it would spend tokens on information the transition line already carries.
    // A stuck parent reads better as an instruction than as another `Next:`.
    const nextLine =
        next && !changedIds.has(next.id)
            ? stuck && stuck.id === next.id
                ? `Mark ${next.id} done.`
                : `Next: ${next.id} ${next.content}`
            : undefined;

    const tail = next
        ? undefined
        : stuck
            ? `Mark ${stuck.id} done.`
            : isAnyTodoActive(todos)
                ? undefined
                : "All done.";

    return [base, nextLine, ...lines, tail].filter(Boolean).join("\n");
}
