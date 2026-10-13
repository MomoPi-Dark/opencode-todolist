import { z } from "zod";

export const TodoStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "error",
]);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const PrioritySchema = z.enum(["high", "medium", "low"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const OPEN_STATUSES: readonly TodoStatus[] = [
  "pending",
  "in_progress",
  "error",
];

/** Human-readable labels used in the resume prompt. */
export const StatusLabel: Record<TodoStatus, string> = {
  pending: "not started",
  in_progress: "currently being worked on",
  completed: "completed",
  cancelled: "cancelled",
  error: "needs fixing",
};
