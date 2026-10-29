import { describe, expect, test } from "bun:test";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { createTodoSubscription, type TodoClient } from "../../src/rpc";

/** The client is only dereferenced through `rpc(Def).read` / `.events.on`. */
const stubClient = (
    read: () => Promise<unknown>,
    on: () => () => void,
): TodoClient =>
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
        const events: string[] = [];

        const sub = createTodoSubscription(
            { client: () => harness.current, sessionID: () => "session-1" },
            { onData: () => events.push("data") },
        );

        await flush();
        expect(harness.reads).toEqual(["A"]);

        harness.current = makeClient("B", harness);
        sub.refresh();
        await flush();

        expect(harness.reads.at(-1)).toBe("B");
        expect(events.length).toBeGreaterThanOrEqual(2);
        sub.dispose();
    });

    test("the previous listener is unsubscribed on refresh", () => {
        const harness = makeHarness();

        const sub = createTodoSubscription(
            { client: () => harness.current, sessionID: () => "session-1" },
            { onData: () => {} },
        );

        expect(harness.unsubscribed).toEqual([false]);
        sub.refresh();
        expect(harness.unsubscribed[0]).toBe(true);
        expect(harness.unsubscribed).toHaveLength(2);

        sub.dispose();
        expect(harness.unsubscribed[1]).toBe(true);
    });

    test("an unknown session reports undefined once and never reads", () => {
        const harness = makeHarness();
        const seen: Array<TodoRootItem[] | undefined> = [];

        const sub = createTodoSubscription(
            { client: () => harness.current, sessionID: () => undefined },
            { onData: (todos) => seen.push(todos) },
        );

        expect(seen).toEqual([undefined]);
        expect(harness.reads).toEqual([]);
        sub.dispose();
    });

    test("refresh after dispose does nothing", async () => {
        const harness = makeHarness();
        let calls = 0;

        const sub = createTodoSubscription(
            { client: () => harness.current, sessionID: () => "session-1" },
            { onData: () => calls++ },
        );

        sub.dispose();
        const readsBefore = harness.reads.length;
        const callsBefore = calls;
        sub.refresh();
        await flush();

        expect(harness.reads).toHaveLength(readsBefore);
        expect(calls).toBe(callsBefore);
        expect(harness.unsubscribed).toHaveLength(1);
    });

    test("a reply that lands after dispose never reaches onData", async () => {
        const harness = makeHarness();
        let resolveRead: (value: unknown) => void = () => {};
        const pending = new Promise((resolve) => {
            resolveRead = resolve;
        });
        let calls = 0;

        harness.current = stubClient(
            () => {
                harness.reads.push("slow");
                return pending;
            },
            () => () => {},
        );

        const sub = createTodoSubscription(
            { client: () => harness.current, sessionID: () => "session-1" },
            { onData: () => calls++ },
        );

        // The read is still in flight; disposing must silence its result.
        sub.dispose();
        resolveRead({ ok: true, todos: [] });
        await flush();

        expect(calls).toBe(0);
    });

    test("a failed read goes to onError, not onData", async () => {
        const harness = makeHarness();
        const errors: unknown[] = [];
        let dataCalls = 0;

        harness.current = stubClient(
            async () => {
                throw new Error("boom");
            },
            () => () => {},
        );

        const sub = createTodoSubscription(
            { client: () => harness.current, sessionID: () => "session-1" },
            { onData: () => dataCalls++, onError: (error) => errors.push(error) },
        );

        await flush();

        expect(errors).toHaveLength(1);
        expect(dataCalls).toBe(0);
        sub.dispose();
    });
});
