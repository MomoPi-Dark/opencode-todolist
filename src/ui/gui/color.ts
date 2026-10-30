import { TodoViewItem } from "../../rpc";

export const BASE = "var(--v2-text-text-base)";
export const MUTED = "var(--v2-text-text-muted)";
export const FAINT = "var(--v2-text-text-faint)";
export const DANGER = "var(--v2-state-fg-danger)";

export const STATUS_COLOR: Record<TodoViewItem["status"], string> = {
    pending: MUTED,
    in_progress: BASE,
    completed: "var(--v2-state-fg-success)",
    cancelled: FAINT,
    error: DANGER,
};
