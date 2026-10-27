// import type { Plugin } from "@opencode/plugin";
// import { afterEach, describe, expect, test } from "bun:test";
// import { mkdtempSync, rmSync } from "node:fs";
// import { tmpdir } from "node:os";
// import { join } from "node:path";
// import { registerTodoTools, resetStoreForTests } from "../../src/index.1";

// /**
//  * Registration tests.
//  *
//  * The tool is registered through a transform callback, so the only way to know
//  * `execute` actually works is to run it against a real (temp) database. These
//  * tests stand in for the runtime: they capture the tool the plugin adds, then
//  * call `execute` the way the server would.
//  *
//  * What is worth pinning here is the *shape of the answer*, not the rules — the
//  * rules have their own tests. A caller sees `content` always, `output` only on
//  * success, and a `code` in metadata whenever the call was refused.
//  */

// const dirs: string[] = [];

// afterEach(() => {
//     resetStoreForTests();
//     for (const dir of dirs.splice(0))
//         rmSync(dir, { recursive: true, force: true });
// });

// interface Captured {
//     name: string;
//     description: string;
//     execute: (
//         input: unknown,
//         context: { sessionID: string },
//     ) => Promise<{
//         content?: string;
//         output?: { todos: unknown[] };
//         metadata?: Record<string, unknown>;
//     }>;
// }

// /** Runs the plugin's transform against a fake editor and returns the tool. */
// async function captureTool(): Promise<Captured> {
//     let captured: Captured | undefined;

//     const context = {
//         tool: {
//             transform: async (callback: (editor: unknown) => void) => {
//                 callback({
//                     add: (tool: Captured) => {
//                         captured = tool;
//                     },
//                 });
//                 return { dispose: async () => { } };
//             },
//         },
//         // The plugin also registers its skill; a no-op editor is enough here.
//         skill: {
//             transform: async (callback: (editor: unknown) => void) => {
//                 callback({ add: () => { } });
//                 return { dispose: async () => { } };
//             },
//         },
//     } as unknown as Plugin.Context;

//     await registerTodoTools(context);
//     if (!captured) throw new Error("the plugin registered no tool");
//     return captured;
// }

// function useTempDatabase(): void {
//     const dir = mkdtempSync(join(tmpdir(), "todo-index-"));
//     dirs.push(dir);
//     process.env.OPENCODE_TODOS_DIR = dir;
//     resetStoreForTests();
// }

// const session = { sessionID: "session-a" };

// const plan = [
//     {
//         id: 1,
//         content: "Build storage",
//         status: "in_progress" as const,
//         children: [
//             { id: 1.1, content: "schema", status: "completed" as const },
//             { id: 1.2, content: "store", status: "in_progress" as const },
//         ],
//     },
//     { id: 2, content: "Wire the tool", status: "pending" as const },
// ];

// describe("registerTodoTools", () => {
//     test("registers exactly one tool named manage_todo_list", async () => {
//         useTempDatabase();
//         const tool = await captureTool();
//         expect(tool.name).toBe("manage_todo_list");
//         expect(tool.description).toContain("create");
//         expect(tool.description).toContain("update");
//     });

//     test("a create call stores the plan and answers with the tree", async () => {
//         useTempDatabase();
//         const tool = await captureTool();

//         const result = await tool.execute(
//             { operation: "create", todos: plan },
//             session,
//         );

//         expect(result.content).toContain("[~] 1. Build storage (1/2)");
//         expect(result.output?.todos).toHaveLength(2);
//         expect(result.metadata?.operation).toBe("create");

//         // The write really landed: a read from the same session sees it.
//         const read = await tool.execute(
//             { operation: "read", format: "tree" },
//             session,
//         );
//         expect(read.content).toContain("1. Build storage");
//         expect(read.content).toContain("1.2 store");
//     });

//     test("a successful update reports progress in metadata", async () => {
//         useTempDatabase();
//         const tool = await captureTool();
//         await tool.execute({ operation: "create", todos: plan }, session);

//         const result = await tool.execute(
//             { operation: "update", updates: [{ id: 1.2, status: "completed" }] },
//             session,
//         );

//         expect(result.metadata).toMatchObject({
//             operation: "update",
//             completed_subtasks: 2,
//             total_subtasks: 3,
//             percent: 67,
//         });
//     });

//     test("a refusal answers with a message, a code, and no output", async () => {
//         useTempDatabase();
//         const tool = await captureTool();
//         await tool.execute({ operation: "create", todos: plan }, session);

//         const refused = await tool.execute(
//             { operation: "update", updates: [{ id: 2, status: "in_progress" }] },
//             session,
//         );

//         expect(refused.output).toBeUndefined();
//         expect(refused.metadata).toMatchObject({
//             operation: "update",
//             code: "root_out_of_order",
//         });
//         expect(refused.content).toContain("Nothing was applied");
//     });

//     test("a refused call does not change what is stored", async () => {
//         useTempDatabase();
//         const tool = await captureTool();
//         await tool.execute({ operation: "create", todos: plan }, session);

//         await tool.execute(
//             { operation: "update", updates: [{ id: 2, status: "in_progress" }] },
//             session,
//         );

//         const read = await tool.execute({ operation: "read" }, session);
//         expect(read.content).toContain("[ ] 2. Wire the tool");
//     });

//     test("clear empties the stored list", async () => {
//         useTempDatabase();
//         const tool = await captureTool();
//         await tool.execute(
//             {
//                 operation: "create",
//                 todos: [{ id: 1, content: "only", status: "completed" }],
//             },
//             session,
//         );

//         const cleared = await tool.execute(
//             { operation: "clear", confirm: true },
//             session,
//         );
//         expect(cleared.content).toBe("Cleared 1 todo.");
//         expect(cleared.output?.todos).toEqual([]);

//         const read = await tool.execute({ operation: "read" }, session);
//         expect(read.content).toBe("No todos recorded.");
//     });

//     test("two sessions do not see each other's list", async () => {
//         useTempDatabase();
//         const tool = await captureTool();
//         await tool.execute({ operation: "create", todos: plan }, session);

//         const other = await tool.execute(
//             { operation: "read" },
//             { sessionID: "session-b" },
//         );
//         expect(other.content).toBe("No todos recorded.");
//     });

//     test("an unusable session id fails loudly instead of reading the wrong rows", async () => {
//         // `TodoStore.sessionKey` rejects ids outside `[A-Za-z0-9_-]`. The host
//         // always sends `ses_...`, so a bad id means the caller is broken and
//         // should hear about it rather than silently get an empty list.
//         useTempDatabase();
//         const tool = await captureTool();
//         await expect(
//             tool.execute({ operation: "read" }, { sessionID: "bad id" }),
//         ).rejects.toThrow();
//     });

//     test("malformed input is answered without touching storage", async () => {
//         useTempDatabase();
//         const tool = await captureTool();

//         // Bypasses the runtime's own validation on purpose: `execute` must not
//         // trust its caller.
//         const result = await tool.execute(
//             { operation: "update", updates: [{ id: 1 }] },
//             session,
//         );

//         expect(result.content).toContain("Invalid manage_todo_list input");
//         expect(result.metadata).toMatchObject({ code: "invalid_input" });
//         expect(result.output).toBeUndefined();
//     });
// });

// describe("store lifecycle", () => {
//     test("the database file is created on first use, not at setup", async () => {
//         useTempDatabase();
//         const dir = process.env.OPENCODE_TODOS_DIR as string;
//         const tool = await captureTool();

//         // Registration alone must not create anything: an installed-but-unused
//         // plugin should leave no trace.
//         const { existsSync } = await import("node:fs");
//         expect(existsSync(join(dir, "todos.db"))).toBe(false);

//         await tool.execute({ operation: "read" }, session);
//         expect(existsSync(join(dir, "todos.db"))).toBe(true);
//     });
// });
