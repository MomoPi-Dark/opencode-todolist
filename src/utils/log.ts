/**
 * Logging sink for the plugin.
 *
 * The project's other packages use Pino, but a plugin runs inside the OpenCode
 * process and owns no transport, so `console.error` is the one sink available
 * without adding a dependency. Centralising it here means call sites never talk to
 * `console` directly, and swapping in Pino later is a change to this file only.
 */

const DEBUG = process.env.TODO_DEBUG === "1";

/** Debug-only logging: silent unless `TODO_DEBUG=1`. */
export const debug = (...args: readonly unknown[]): void => {
    if (DEBUG) console.error("[todo]", ...args);
};

/** Failures that must surface without `TODO_DEBUG`. */
export const error = (...args: readonly unknown[]): void => {
    console.error("[todo]", ...args);
};
