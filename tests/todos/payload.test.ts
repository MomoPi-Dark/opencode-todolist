import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
 * Payload budget suite — the *arguments* a handler hands back to the model.
 *
 * Every handler returns two things, and the model reads both:
 *
 * - `content`: the rendered text. Cheap, and the only part a human would call
 *   "the answer".
 * - `todos`: the same information again as structured data, because the tool
 *   declares an output schema. This is the expensive half — key names and
 *   punctuation are about half of it.
 *
 * That duplication is the point of this file: it makes the real per-call cost
 * visible instead of counting only `content` and assuming the rest is free.
 *
 * Tokens are estimated as `chars / 3.6`, the ratio the design notes used. It is
 * an estimate, so ceilings absorb the error and guard against regressions of
 * tens of tokens.
 */
const tok = (text: string) => Math.ceil(text.length / 3.6);

interface Payload {
    ok: boolean;
    content?: string;
    error?: { message: string };
    todos: TodoRootItem[];
}

/** Total cost a model pays for one tool call: text plus structured rows. */
const payload = (result: Payload) => ({
    content: tok(
        result.ok ? (result.content as string) : (result.error?.message as string),
    ),
    structured: tok(JSON.stringify(result.todos)),
    get total() {
        return this.content + this.structured;
    },
});

function budget(label: string, result: Payload, ceiling: number): number {
    const p = payload(result);
    expect(p.total).toBeLessThanOrEqual(ceiling);
    console.log(
        `  ${label.padEnd(28)} content ${String(p.content).padStart(4)} + structured ${String(p.structured).padStart(4)} = ${String(p.total).padStart(4)} tok  (max ${ceiling})`,
    );
    return p.total;
}

/** A realistic six-step plan with notes, the shape a session actually reaches. */
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

const sessionID = "payload-session";
let testDir = "";
let previousTodoDir: string | undefined;

beforeEach(() => {
    previousTodoDir = process.env.OPENCODE_TODOS_DIR;
    testDir = mkdtempSync(join(tmpdir(), "todo-payload-"));
    process.env.OPENCODE_TODOS_DIR = testDir;
    resetTodoStoreForTests();
});

afterEach(() => {
    resetTodoStoreForTests();
    rmSync(testDir, { recursive: true, force: true });
    if (previousTodoDir === undefined) delete process.env.OPENCODE_TODOS_DIR;
    else process.env.OPENCODE_TODOS_DIR = previousTodoDir;
});

const runUpdate = async (
    todos: TodoRootItem[],
    updates: TodoUpdateItem[],
): Promise<Payload> => {
    await writeTodos(sessionID, todos);
    return (await handleUpdate(sessionID, {
        operation: "update",
        updates,
    })) as unknown as Payload;
};

describe("payload sent back to the model", () => {
    test("a full read costs about 230 tokens, most of it structured", () => {
        const result = handleRead(plan, {
            operation: "read",
            format: "tree",
            scope: "all",
        }) as Payload;
        const p = payload(result);

        budget("read (all)", result, 240);
        // The structured copy dominates; that is what the output schema buys and
        // what a caller could drop by returning `content` alone.
        expect(p.structured).toBeGreaterThan(p.content);
    });

    test("the structured copy is mostly key names, not data", () => {
        // 56% of the JSON is `"id"`, `"content"`, `"status"`, braces and commas.
        // Worth knowing before shrinking anything else.
        const result = handleRead(plan, {
            operation: "read",
            format: "tree",
            scope: "all",
        }) as Payload;

        const json = JSON.stringify(result.todos);
        const values: string[] = [];
        const walk = (node: unknown): void => {
            if (Array.isArray(node)) return node.forEach(walk);
            if (node && typeof node === "object") {
                return Object.values(node).forEach(walk);
            }
            values.push(String(node));
        };
        walk(result.todos);
        const valueChars = values.reduce((sum, v) => sum + v.length, 0);

        expect((json.length - valueChars) / json.length).toBeGreaterThan(0.5);
    });

    test("scoped read is the cheapest way to look at one row", () => {
        const scoped = handleRead(plan, {
            operation: "read",
            format: "tree",
            scope: "item",
            target: 2.2,
        }) as Payload;
        // Only root 2 is returned, so even the structured half shrinks.
        budget("read (scope item 2.2)", scoped, 80);
        expect(scoped.todos).toHaveLength(1);
    });

    test("the hottest path — one status change — stays under 240 tokens", async () => {
        budget(
            "update (one change)",
            await runUpdate(plan, [{ id: 3, status: "completed" }]),
            240,
        );
    });

    test("a refusal costs less than a successful call", async () => {
        // The refused call returns the list unchanged, so it pays the structured
        // cost but a much shorter message.
        const refused = payload(
            await runUpdate(plan, [{ id: 5, status: "in_progress" }]),
        );
        const accepted = payload(
            await runUpdate(plan, [{ id: 3, status: "completed" }]),
        );

        expect(refused.content).toBeLessThan(80);
        expect(accepted.content).toBeGreaterThan(0);
        budget(
            "update (refused)",
            await runUpdate(plan, [{ id: 5, status: "in_progress" }]),
            200,
        );
    });

    test("clear is the only operation that returns an empty payload", () => {
        const result = handleClear([
            { id: 1, content: "x", status: "completed" },
        ]) as Payload;
        expect(result.todos).toEqual([]);
        budget("clear", result, 10);
    });

    test("create returns the new plan, so its structured payload matches a read", () => {
        const created = payload(
            handleCreate([], { operation: "create", todos: plan }) as Payload,
        );
        const read = payload(
            handleRead(plan, {
                operation: "read",
                format: "tree",
                scope: "all",
            }) as Payload,
        );
        expect(created.structured).toBe(read.structured);
    });
});

/**
 * The canonical shape this plugin is designed for: five roots, five subtasks
 * each, so 30 rows. Every budget below is anchored to it, because a budget
 * measured on a two-row toy list says nothing about real use.
 */
const shape: TodoRootItem[] = (() => {
    const roots = [
        "Baca schema todo",
        "Tulis todotree",
        "Tulis rules validasi",
        "Tulis handler operasi",
        "Tulis test",
    ];
    const kids = [
        ["id schema", "item schema", "fields", "status enum", "parseJson"],
        [
            "type dari z.infer",
            "helper statis",
            "validate + normalize",
            "calculateStats",
            "render",
        ],
        [
            "tabel transisi",
            "checkScope",
            "apply batch atomik",
            "cancel_remaining",
            "pesan error",
        ],
        [
            "handler read",
            "handler create",
            "handler update",
            "handler clear",
            "dispatcher",
        ],
        [
            "test todotree",
            "test rules",
            "test handler",
            "test budget",
            "test payload",
        ],
    ];

    return roots.map((content, i) => ({
        id: i + 1,
        content,
        status: (i === 0
            ? "completed"
            : i === 1
                ? "in_progress"
                : "pending") as TodoRootItem["status"],
        ...(i === 1 ? { note: "sedang dikerjakan" } : {}),
        children: (kids[i] ?? []).map((kid, j) => ({
            id: i + 1 + (j + 1) / 10,
            content: kid,
            status: (i === 0
                ? "completed"
                : i === 1 && j === 2
                    ? "in_progress"
                    : "pending") as TodoRootItem["status"],
            ...(i === 1 && j === 2 ? { note: "created: src/todos/rules.ts" } : {}),
        })),
    }));
})();

describe("the canonical shape: 5 roots x 5 subtasks", () => {
    test("a full read of it costs about 750 tokens", () => {
        // 245 tok of text, 505 tok of structured rows. The structured copy is
        // twice the text, which is the whole reason this suite exists.
        budget(
            "read (5x5, all)",
            handleRead(shape, {
                operation: "read",
                format: "tree",
                scope: "all",
            }) as Payload,
            760,
        );
    });

    test("the structured copy outweighs the text by ~2x", () => {
        const p = payload(
            handleRead(shape, {
                operation: "read",
                format: "tree",
                scope: "all",
            }) as Payload,
        );
        expect(p.structured).toBeGreaterThan(p.content * 1.8);
    });

    test("summary format barely helps while `todos` is returned", () => {
        // Dropping the text from 245 to 35 tok saves little when 505 tok of
        // structured rows come along for the ride. Worth pinning so nobody
        // "optimises" the text and wonders why the bill did not move.
        const tree = payload(
            handleRead(shape, {
                operation: "read",
                format: "tree",
                scope: "all",
            }) as Payload,
        );
        const summary = payload(
            handleRead(shape, {
                operation: "read",
                format: "summary",
                scope: "all",
            }) as Payload,
        );
        expect(summary.total).toBeGreaterThan(tree.content);
    });

    test("a scoped read is 4x cheaper than the whole list", () => {
        const all = payload(
            handleRead(shape, {
                operation: "read",
                format: "tree",
                scope: "all",
            }) as Payload,
        );
        const item = payload(
            handleRead(shape, {
                operation: "read",
                format: "tree",
                scope: "item",
                target: 2.3,
            }) as Payload,
        );
        budget(
            "read (scope item 2.3)",
            handleRead(shape, {
                operation: "read",
                format: "tree",
                scope: "item",
                target: 2.3,
            }) as Payload,
            160,
        );
        expect(item.total).toBeLessThan(all.total / 4);
    });

    test("one status change costs about the same as a full read", async () => {
        // The hottest path is not cheap at this size: every update echoes the
        // whole tree, both as text and as rows.
        budget(
            "update (5x5, 1 change)",
            await runUpdate(shape, [{ id: 2.3, status: "completed" }]),
            760,
        );
    });

    test("a working session of 5 reads + 10 updates costs ~11k tokens", async () => {
        const read = payload(
            handleRead(shape, {
                operation: "read",
                format: "tree",
                scope: "all",
            }) as Payload,
        );
        const update = payload(
            await runUpdate(shape, [{ id: 2.3, status: "completed" }]),
        );
        const total = read.total * 5 + update.total * 10;

        expect(total).toBeLessThan(12_000);
        console.log(
            `  ${"session: 5 read + 10 update".padEnd(28)} ~${total} tok total`,
        );
    });

    test("returning text only would cut most of every call", () => {
        // The number that motivates dropping the structured copy from `read`.
        const p = payload(
            handleRead(shape, {
                operation: "read",
                format: "tree",
                scope: "all",
            }) as Payload,
        );
        const saved = 1 - p.content / p.total;
        expect(saved).toBeGreaterThan(0.5);
    });
});

describe("payload growth with list size", () => {
    const build = (roots: number, withKids: boolean): TodoRootItem[] =>
        Array.from({ length: roots }, (_, i) => ({
            id: i + 1,
            content: `Task number ${i + 1}`,
            status: "pending" as const,
            ...(withKids
                ? {
                    children: [
                        {
                            id: i + 1 + 0.1,
                            content: `Sub ${i + 1}.1`,
                            status: "pending" as const,
                        },
                        {
                            id: i + 1 + 0.2,
                            content: `Sub ${i + 1}.2`,
                            status: "pending" as const,
                        },
                    ],
                }
                : {}),
        }));

    const measure = (roots: number, withKids: boolean) => {
        const todos = build(roots, withKids);
        return payload(
            handleRead(todos, {
                operation: "read",
                format: "tree",
                scope: "all",
            }) as Payload,
        );
    };

    test("cost grows linearly with the number of rows", () => {
        const three = measure(3, false);
        const six = measure(6, false);
        const twelve = measure(12, false);

        expect(six.total).toBeGreaterThan(three.total);
        expect(twelve.total).toBeGreaterThan(six.total);
        // Roughly linear: doubling the rows should less than triple the cost.
        expect(twelve.total).toBeLessThan(three.total * 5);
    });

    test("subtasks are the expensive shape", () => {
        // Same root count, but every root carries two subtasks.
        const flat = measure(6, false);
        const nested = measure(6, true);
        expect(nested.total).toBeGreaterThan(flat.total * 2);
    });

    test("a 12-root plan with subtasks stays under 800 tokens", () => {
        // The realistic worst case before anyone should reach for `scope`.
        budget(
            "read (12 roots x 2 subs)",
            {
                ok: true,
                content: (
                    handleRead(build(12, true), {
                        operation: "read",
                        format: "tree",
                        scope: "all",
                    }) as Payload
                ).content,
                todos: build(12, true),
            } as Payload,
            800,
        );
    });
});
