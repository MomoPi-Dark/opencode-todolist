import z from "zod";

export const TodoStatusSchema = z
  .enum(["pending", "in_progress", "completed", "cancelled", "error"])
  .describe(
    "pending: not started; in_progress: being worked on; completed: done; cancelled: dropped on purpose; error: failed and needs fixing (still open).",
  );
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const PrioritySchema = z
  .enum(["high", "medium", "low"])
  .describe("Task priority: high, medium or low.");
export type Priority = z.infer<typeof PrioritySchema>;

export const OPEN_STATUSES = [
  "pending",
  "in_progress",
  "error",
] as const satisfies readonly TodoStatus[];
export type OpenStatus = (typeof OPEN_STATUSES)[number];

export const CLOSED_STATUSES = [
  "completed",
  "cancelled",
] as const satisfies readonly TodoStatus[];
export type ClosedStatus = (typeof CLOSED_STATUSES)[number];

export const CANCELLING_STATUSES = [
  "cancelled",
] as const satisfies readonly TodoStatus[];
export type CancellingStatus = (typeof CANCELLING_STATUSES)[number];

export const isOpenStatus = (status: TodoStatus): status is OpenStatus =>
  (OPEN_STATUSES as readonly TodoStatus[]).includes(status);

export const isClosedStatus = (status: TodoStatus): status is ClosedStatus =>
  (CLOSED_STATUSES as readonly TodoStatus[]).includes(status);

export const isCancellingStatus = (
  status: TodoStatus,
): status is CancellingStatus =>
  (CANCELLING_STATUSES as readonly TodoStatus[]).includes(status);
