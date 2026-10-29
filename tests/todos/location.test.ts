import { describe, expect, test } from "bun:test";
import { createTodoStore, legacyKey } from "../../src/storage/todo-store";

const base = (ctx: Parameters<typeof createTodoStore>[0]) =>
    createTodoStore(ctx).resolveTodosBaseDir();

describe("todo base directory", () => {
    test("linux: <home>/.local/share/opencode/todolist", () => {
        expect(base({ platform: "linux", env: {}, home: "/home/u" })).toBe(
            "/home/u/.local/share/opencode/todolist",
        );
    });

    test("win32: same rule under the user profile", () => {
        expect(base({ platform: "win32", env: {}, home: "C:\\Users\\u" })).toBe(
            "C:\\Users\\u\\.local\\share\\opencode\\todolist",
        );
    });

    test("XDG_DATA_HOME wins over the home default", () => {
        expect(
            base({
                platform: "linux",
                env: { XDG_DATA_HOME: "/data" },
                home: "/home/u",
            }),
        ).toBe("/data/opencode/todolist");
    });

    test("relative XDG_DATA_HOME is ignored (spec: must be absolute)", () => {
        expect(
            base({
                platform: "linux",
                env: { XDG_DATA_HOME: "rel" },
                home: "/home/u",
            }),
        ).toBe("/home/u/.local/share/opencode/todolist");
    });

    test("OPENCODE_TODOS_DIR overrides everything when absolute", () => {
        expect(
            base({
                platform: "linux",
                env: { OPENCODE_TODOS_DIR: "/tmp/x", XDG_DATA_HOME: "/data" },
                home: "/home/u",
            }),
        ).toBe("/tmp/x");
    });

    test("relative OPENCODE_TODOS_DIR is rejected", () => {
        expect(() =>
            base({
                platform: "linux",
                env: { OPENCODE_TODOS_DIR: "rel/dir" },
                home: "/home/u",
            }),
        ).toThrow(/absolute/);
    });

    test("win32 absolute override is accepted", () => {
        expect(
            base({
                platform: "win32",
                env: { OPENCODE_TODOS_DIR: "D:\\todos" },
                home: "C:\\Users\\u",
            }),
        ).toBe("D:\\todos");
    });
});
