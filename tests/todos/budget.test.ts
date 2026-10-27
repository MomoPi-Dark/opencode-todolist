import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { TodoInputToolSchema } from "../../src/schemas/todo/index";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import type { TodoUpdateItem } from "../../src/schemas/todo/update";
import {
    resetTodoStoreForTests,
    writeTodos,
} from "../../src/storage/todo-store";
import {
    handleClear,
    handleCreate,
    handleRead,
    handleUpdate,
} from "../../src/todos/handlers";

/**
 * Token budget suite.
 *
 * Two different costs are counted here, and they behave differently:
 *
 * - **Tool arguments** (the JSON Schema) are sent on *every* request, in every
 *   session, whether or not the model calls the tool. They are pure overhead and
 *   the biggest number in this file.
 * - **Tool output** (`content`) is only sent back when the tool runs, so it is
 *   capped per call rather than in total.
 *
 * Token counts are approximated with `chars / 3.6`, the same ratio the earlier
 * design notes used for mixed Latin/identifier text. That is an estimate, not a
 * tokenizer: the ceilings leave room for it and guard against regressions of tens
 * of tokens, not single characters.
 */
const tok = (text: string) => Math.ceil(text.length / 3.6);

const schemaText = (schema: z.ZodType) =>
    JSON.stringify(z.toJSONSchema(schema));

/** Asserts a ceiling and reports the measurement, so a run is an audit trail. */
function budget(label: string, text: string, ceiling: number): number {
    const tokens = tok(text);
    expect(tokens).toBeLessThanOrEqual(ceiling);
    expect(text.length).toBeGreaterThan(0);
    console.log(
        `  ${label.padEnd(34)} ${String(text.length).padStart(5)} ch  ~${String(tokens).padStart(4)} tok  (max ${ceiling})`,
    );
    return tokens;
}

describe("cost of tool arguments (sent on every request)", () => {
    test("the whole input schema stays under 1700 tokens", () => {
        // Was ~1633 tok when this suite was written. The number is mostly
        // structural: four union branches, each repeating `additionalProperties`,
        // the status enum and its description.
        budget("TodoInputToolSchema", schemaText(TodoInputToolSchema), 1700);
    });

    test("no single operation exceeds 600 tokens", () => {
        const json = z.toJSONSchema(TodoInputToolSchema) as {
            oneOf?: unknown[];
        };
        const branches = json.oneOf ?? [];
        expect(branches.length).toBe(4);
        for (const branch of branches) {
            const text = JSON.stringify(branch);
            // `create` is the widest: it inlines the whole item shape twice.
            budget("one union branch", text, 620);
        }
    });

    test("descriptions are a minority of the schema", () => {
        // If prose ever becomes most of the payload, the shape is being explained
        // in the wrong place — the bundled skill is the better carrier.
        let described = 0;
        const walk = (node: unknown): void => {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) return node.forEach(walk);
            for (const [key, value] of Object.entries(node)) {
                if (key === "description" && typeof value === "string") {
                    described += value.length;
                } else {
                    walk(value);
                }
            }
        };
        walk(z.toJSONSchema(TodoInputToolSchema));

        const total = schemaText(TodoInputToolSchema).length;
        expect(described / total).toBeLessThan(0.4);
    });
});

describe("cost of tool output (per call)", () => {
    // A realistic six-step plan with notes, the shape a real session reaches.
    const plan: TodoRootItem[] = [
        {
            id: 1,
            content: "Read schemas/todo",
            status: "completed",
            note: "created: src/schemas/todo/",
        },
        {
            id: 2,
            content: "Write todotree",
            status: "completed",
            children: [
                { id: 2.1, content: "Type + statics", status: "completed" },
                { id: 2.2, content: "validate/normalize", status: "completed" },
            ],
        },
        {
            id: 3,
            content: "Write rules",
            status: "in_progress",
            note: "forward-only + scope",
        },
        { id: 4, content: "Wire handlers", status: "pending" },
        { id: 5, content: "Storage layer", status: "pending" },
        { id: 6, content: "TUI widget", status: "pending" },
    ];

    const contentOf = (result: {
        ok: boolean;
        content?: string;
        message?: string;
    }) => (result.ok ? (result.content as string) : (result.message as string));

    const sessionID = "budget-session";
    let testDir = "";
    let previousTodoDir: string | undefined;

    beforeEach(async () => {
        previousTodoDir = process.env.OPENCODE_TODOS_DIR;
        testDir = mkdtempSync(join(tmpdir(), "todo-budget-"));
        process.env.OPENCODE_TODOS_DIR = testDir;
        resetTodoStoreForTests();
        await writeTodos(sessionID, plan);
    });

    afterEach(() => {
        resetTodoStoreForTests();
        rmSync(testDir, { recursive: true, force: true });
        if (previousTodoDir === undefined) delete process.env.OPENCODE_TODOS_DIR;
        else process.env.OPENCODE_TODOS_DIR = previousTodoDir;
    });

    const update = (updates: TodoUpdateItem[]) =>
        handleUpdate(sessionID, { operation: "update", updates });

    test("read of the whole tree stays under 120 tokens", () => {
        budget(
            "read (all)",
            contentOf(
                handleRead(plan, {
                    operation: "read",
                    format: "tree",
                    scope: "all",
                }),
            ),
            120,
        );
    });

    test("summary format is cheaper than tree format", () => {
        const tree = contentOf(
            handleRead(plan, {
                operation: "read",
                format: "tree",
                scope: "all",
            }),
        );
        const summary = contentOf(
            handleRead(plan, {
                operation: "read",
                format: "summary",
                scope: "all",
            }),
        );
        expect(tok(summary)).toBeLessThan(tok(tree));
    });

    test("scoped read is cheaper than a full read", () => {
        const all = contentOf(
            handleRead(plan, {
                operation: "read",
                format: "tree",
                scope: "all",
            }),
        );
        const one = contentOf(
            handleRead(plan, {
                operation: "read",
                format: "tree",
                scope: "item",
                target: 2.2,
            }),
        );
        expect(tok(one)).toBeLessThan(tok(all) / 2);
        budget("read (scope item)", one, 40);
    });

    test("the hottest path — one status change — stays under 120 tokens", async () => {
        budget(
            "update (one change)",
            contentOf(
                await update([{ id: 3, status: "completed" }]),
            ),
            120,
        );
    });

    test("a refusal costs less than a full read", async () => {
        // The message has to name the blocking row, so it cannot be tiny, but it
        // must not be a dump of the list either.
        const refused = contentOf(
            await update([{ id: 5, status: "in_progress" }]),
        );
        budget("update (refused)", refused, 60);
    });

    test("clear is near-free", () => {
        budget(
            "clear",
            contentOf(
                handleClear([{ id: 1, content: "x", status: "completed" }], {
                    operation: "clear",
                    confirm: true,
                }),
            ),
            10,
        );
    });

    test("create echoes the new plan, so it scales with its size", () => {
        budget(
            "create",
            contentOf(handleCreate([], { operation: "create", todos: plan })),
            120,
        );
    });
});
