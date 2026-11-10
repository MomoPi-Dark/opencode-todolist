/**
 * The event types the todo panels subscribe to.
 *
 * `subscribe` needs the list up front, unlike the TUI's `data.listen`, so the
 * list lives in one place for both hosts. Every entry maps to a case in
 * `asBusyEvent`; adding one there still means adding it here.
 */
export const BUSY_EVENT_TYPES = [
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.idle",
  "session.status",
] as const;
