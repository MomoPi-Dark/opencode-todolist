/**
 * Whether a session is still working, derived from the session events both
 * panels listen to.
 *
 * The spinner must stop the moment a session goes idle, and OpenCode reports
 * that as `session.status` (`idle`) or `session.idle` — not as an
 * `session.execution.*` event. Listening only to the execution events left the
 * spinner running forever after a manual stop, so both idle shapes are handled
 * here and covered by tests.
 *
 * Kept pure so the mapping is testable without mounting a panel, and typed
 * against the client's own events so a shape change fails to compile. The TUI
 * and the GUI both map their events through this module, so they cannot drift
 * apart again.
 */
export type BusyEvent =
    | { type: "session.execution.started" }
    | { type: "session.execution.succeeded" }
    | { type: "session.execution.failed" }
    | { type: "session.execution.interrupted" }
    | { type: "session.idle" }
    | { type: "session.status"; data: { status: { type: string } } };

/** A client event reduced to the fields this module reads. */
export interface BusyEventSource {
    type: string;
    data: object;
}

/** The narrowed event, or `undefined` when it does not concern `busy`. */
export function asBusyEvent(
    event: BusyEventSource,
): (BusyEvent & { sessionID: string }) | undefined {
    const data = event.data as {
        sessionID?: string;
        status?: { type: string };
    };
    const sessionID = data.sessionID;
    if (!sessionID) return undefined;

    switch (event.type) {
        case "session.execution.started":
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
        case "session.idle":
            return { type: event.type, sessionID };
        case "session.status": {
            const status = data.status;
            return status
                ? { type: "session.status", data: { status }, sessionID }
                : undefined;
        }
        default:
            return undefined;
    }
}

/** The next `busy` value, or `undefined` for an event that does not affect it. */
export function nextBusy(event: BusyEvent): boolean | undefined {
    switch (event.type) {
        case "session.execution.started":
            return true;
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
        case "session.idle":
            return false;
        case "session.status":
            return event.data.status.type !== "idle";
    }
}
