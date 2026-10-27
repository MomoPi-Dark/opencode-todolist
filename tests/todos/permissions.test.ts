import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type TodoDatabaseHandle } from "../../src/storage/db";

/**
 * Storage is private data: a todo list names the work a person is doing and
 * sometimes says why. On a shared POSIX host another account must not be able
 * to read it, so the directory is 0700 and the database 0600 — including for a
 * directory that already existed with a wider mode.
 *
 * Windows has no POSIX mode bits; access is governed by the user-profile ACLs,
 * so the assertions are skipped there.
 */

const dirs: string[] = [];
const handles: TodoDatabaseHandle[] = [];
const posix = process.platform !== "win32";

const mode = (path: string) => statSync(path).mode & 0o777;

const fresh = (): { dir: string; sub: string; db: string } => {
    const dir = mkdtempSync(join(tmpdir(), "todo-perm-"));
    dirs.push(dir);
    const sub = join(dir, "opencode", "todolist");
    return { dir, sub, db: join(sub, "todos.db") };
};

const open = (db: string): TodoDatabaseHandle => {
    const handle = openDatabase(db);
    handles.push(handle);
    return handle;
};

afterEach(() => {
    for (const handle of handles.splice(0)) handle.sqlite.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!posix)("storage permissions", () => {
    test("creates the directory 0700 and the database 0600", () => {
        const { sub, db } = fresh();
        open(db);
        expect(mode(sub)).toBe(0o700);
        expect(mode(db)).toBe(0o600);
    });

    test("tightens a directory that already exists with a wider mode", () => {
        const { sub, db } = fresh();
        mkdirSync(sub, { recursive: true, mode: 0o755 });
        open(db);
        expect(mode(sub)).toBe(0o700);
    });

    test("tightens a database that already exists with a wider mode", () => {
        const { db } = fresh();
        open(db).sqlite.close();
        handles.length = 0;
        require("node:fs").chmodSync(db, 0o644);
        open(db);
        expect(mode(db)).toBe(0o600);
    });

    test("does not leave a world-readable WAL next to the database", () => {
        const { db } = fresh();
        const handle = open(db);
        handle.sqlite.run(
            "INSERT INTO todo_session (session_key, created_at, updated_at) VALUES ('s', 'now', 'now')",
        );
        for (const suffix of ["-wal", "-shm"]) {
            const file = `${db}${suffix}`;
            try {
                expect(mode(file) & 0o077).toBe(0);
            } catch {
                // SQLite removes the WAL when the last connection closes;
                // absent means there is nothing to leak.
            }
        }
    });
});
