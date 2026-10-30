import { isOpenStatus, type TodoStatus } from "../../schemas/todo/status";

export const STATUS_LABEL: Record<TodoStatus, string> = {
    pending: "not started",
    in_progress: "currently being worked on",
    completed: "completed",
    cancelled: "cancelled",
    error: "needs fixing",
};

export const CONTINUE_PROMPT_MAX_ITEMS = 3;
export const CONTINUE_PROMPT_MAX_CONTENT = 60;
export const CONTINUE_PROMPT_MAX_NOTE = 60;

export function shorten(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

export function formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

interface PromptTodoItem {
    id: number;
    content: string;
    status: TodoStatus;
    depth: number;
    note?: string;
}

export interface PromptSummary {
    completed: number;
    total: number;
    items: readonly PromptTodoItem[];
}

export function continuePrompt(summary: PromptSummary | null): string {
    const open = summary?.items.filter((item) => isOpenStatus(item.status)) ?? [];
    const shown = open.slice(0, CONTINUE_PROMPT_MAX_ITEMS);
    const hidden = open.length - shown.length;

    const lines = [
        "Continue the current todolist.",
        "First call manage_todo_list [read] to reconcile the stored list with this summary.",
    ];

    if (summary) {
        lines.push(`Progress: ${summary.completed}/${summary.total} completed.`);
    }

    if (open.length) {
        lines.push(
            "Open items that still need work (work items run in order; pick the first unfinished item):",
        );
        for (const item of shown) {
            const indent = item.depth > 0 ? "  " : "";
            const label = STATUS_LABEL[item.status] ?? item.status;
            const note = item.note
                ? ` (note: ${shorten(item.note, CONTINUE_PROMPT_MAX_NOTE)})`
                : "";
            lines.push(
                `${indent}- ${item.id} (${label}) ${shorten(item.content, CONTINUE_PROMPT_MAX_CONTENT)}${note}`,
            );
        }
        if (hidden > 0) {
            lines.push(`... (${hidden} more open item(s))`);
        }
    } else {
        lines.push("No open items are listed.");
    }

    lines.push(
        "Advance work step by step: do the work, verify it, then call manage_todo_list [update] to mark each step completed or cancelled before moving to the next.",
    );

    return lines.join("\n");
}
