import { describe, expect, test } from "bun:test";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { createTodoSubscription, type TodoClient } from "../../src/rpc";

/**
 * `createTodoSubscription` only calls `client.rpc(Def)` and then `.read` /
 * `.events.on`. `TodoClient` is `Pick<OpenCodeClient, "rpc">`, but the definition
 * argument is typed against the real `Todos` schema, so the stub is asserted once
 * here instead of at every call site.
 */
const stubClient = (read: () => Promise<unknown>, on: () => () => void): TodoClient =>
    ({
        rpc: () => ({ read, events: { on } }),
    }) as unknown as TodoClient;

interface Harness {
    readonly reads: string[];
    readonly unsubscribed: boolean[];
    current: TodoClient;
}

/** One client per label: `read` records its label, `on` records its unsubscribe. */
const makeClient = (label: string, harness: Harness): TodoClient => {
    const on = () => {
        const index = harness.unsubscribed.length;
        harness.unsubscribed.push(false);
        return () => {
            harness.unsubscribed[index] = true;
        };
    };

    return stubClient(async () => {
        harness.reads.push(label);
        return { ok: true, todos: [] as TodoRootItem[] };
    }, on);
};

const makeHarness = (): Harness => {
    const harness: Harness = {
        reads: [],
        unsubscribed: [],
        current: stubClient(async () => ({ ok: true, todos: [] }), () => () => {}),
    };
    harness.current = makeClient("A", harness);
    return harness;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createTodoSubscription", () => {
    test("dereferences the client on every call, so a replaced client is used", async () => {
        const harness = makeHarness();
        const sub = createTodoSubscription({
            client: () => harness.current,
            sessionID: () => "session-1",
            onChange: () => {},
        });

        await flush();
        expect(harness.reads).toEqual(["A"]);

        harness.current = makeClient("B", harness);
        sub.refresh();
        await flush();

        expect(harness.reads.at(-1)).toBe("B");
        sub.dispose();
    });

    test("the previous listener is unsubscribed on refresh", () => {
        const harness = makeHarness();
        const sub = createTodoSubscription({
            client: () => harness.current,
            sessionID: () => "session-1",
            onChange: () => {},
        });

        expect(harness.unsubscribed).toEqual([false]);
        sub.refresh();
        expect(harness.unsubscribed[0]).toBe(true);
        expect(harness.unsubscribed).toHaveLength(2);

        sub.dispose();
        expect(harness.unsubscribed[1]).toBe(true);
    });

    test("no read happens and onChange reports undefined when the session is unknown", () => {
        const harness = makeHarness();
        const seen: Array<TodoRootItem[] | undefined> = [];

        const sub = createTodoSubscription({
            client: () => harness.current,
            sessionID: () => undefined,
            onChange: (todos) => seen.push(todos),
        });

        expect(seen).toEqual([undefined]);
        expect(harness.reads).toEqual([]);
        sub.dispose();
    });

    test("refresh after dispose does nothing", async () => {
        const harness = makeHarness();
        const sub = createTodoSubscription({
            client: () => harness.current,
            sessionID: () => "session-1",
            onChange: () => {},
        });

        sub.dispose();
        const readsBefore = harness.reads.length;
        sub.refresh();
        await flush();

        expect(harness.reads).toHaveLength(readsBefore);
        expect(harness.unsubscribed).toHaveLength(1);
    });
});
