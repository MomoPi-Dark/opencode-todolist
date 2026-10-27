import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    getDatabase,
    resetDatabaseForTests,
    type TodoDatabaseHandle,
} from "../../src/storage/db";

/**
 * The connection cache is a single process-wide slot, not one slot per caller.
 *
 * Two caches used to exist: a module-level one in `db.ts` and a `private handle`
 * field on every `TodoStore`. They could disagree — a store holding a stale
 * handle kept using it after the global had been reset, and the global itself
 * silently ignored a *different* path, returning a connection to the wrong
 * file. One slot that is keyed by path is the whole fix.
 */

const dirs: string[] = [];
const opened: TodoDatabaseHandle[] = [];

const dbPath = (label: string): string => {
    const dir = mkdtempSync(join(tmpdir(), `todo-cache-${label}-`));
    dirs.push(dir);
    return join(dir, "todos.db");
};

const track = (handle: TodoDatabaseHandle): TodoDatabaseHandle => {
    opened.push(handle);
    return handle;
};

afterEach(() => {
    resetDatabaseForTests();
    for (const handle of opened.splice(0)) {
        try {
            handle.sqlite.close();
        } catch {
            // Already closed by a reset; nothing to release.
        }
    }
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("process-wide connection cache", () => {
    test("reuses one connection for the same path", () => {
        const path = dbPath("same");
        const first = track(getDatabase(path));
        const second = getDatabase(path);
        expect(second).toBe(first);
    });

    test("returns a connection to the requested file, not the first one opened", () => {
        const a = dbPath("a");
        const b = dbPath("b");

        const first = track(getDatabase(a));
        const second = track(getDatabase(b));

        expect(second.path).toBe(b);
        expect(second).not.toBe(first);
        // The superseded connection is closed, not leaked.
        expect(() => first.sqlite.query("SELECT 1").get()).toThrow();
    });

    test("reset drops the slot so the next call reopens", () => {
        const path = dbPath("reset");
        const first = track(getDatabase(path));
        resetDatabaseForTests();
        const second = track(getDatabase(path));
        expect(second).not.toBe(first);
    });

    test("stores the cached handle on globalThis so duplicate module loads share one connection", () => {
        const path = dbPath("global");
        const first = track(getDatabase(path));
        const slot = (globalThis as Record<symbol, { path: string; handle: TodoDatabaseHandle } | undefined>)[
            Symbol.for("opencode.todolist.db")
        ];
        expect(slot?.path).toBe(path);
        expect(slot?.handle).toBe(first);
    });
});
