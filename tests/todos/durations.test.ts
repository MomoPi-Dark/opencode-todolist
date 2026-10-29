import { describe, expect, test } from "bun:test";
import type { TodoStatus } from "../../src/schemas/todo/status";
import { TodoDurations } from "../../src/todos/utils/durations";

const item = (id: number, status: TodoStatus) => ({ id, status });

/** Deterministic clock: every `tick` call advances a fixed amount. */
const clock = (start = 1000, step = 0) => {
    let current = start;
    return {
        now: () => current,
        tick: (ms: number) => {
            current += ms;
        },
        advance: () => {
            current += step;
        },
    };
};

const format = (ms: number) => `${ms}ms`;

describe("TodoDurations", () => {
    test("starts the clock when an item enters in_progress", () => {
        const c = clock(1000);
        const tracker = new TodoDurations(c.now, format);

        expect(tracker.observe([item(1, "in_progress")]).size).toBe(0);
        expect(tracker.get(1)).toBeUndefined();
    });

    test("freezes the elapsed time when the item completes", () => {
        const c = clock(1000);
        const tracker = new TodoDurations(c.now, format);

        tracker.observe([item(1, "in_progress")]);
        c.tick(500);
        const finished = tracker.observe([item(1, "completed")]);

        expect(finished.get(1)).toBe("500ms");
        expect(tracker.get(1)).toBe("500ms");
    });

    test("the frozen time does not keep growing afterwards", () => {
        const c = clock(1000);
        const tracker = new TodoDurations(c.now, format);

        tracker.observe([item(1, "in_progress")]);
        c.tick(500);
        tracker.observe([item(1, "completed")]);
        c.tick(5000);

        expect(tracker.observe([item(1, "completed")]).get(1)).toBe("500ms");
    });

    test("a completed item that never started has no elapsed time", () => {
        const tracker = new TodoDurations(clock().now, format);
        expect(tracker.observe([item(1, "completed")]).size).toBe(0);
    });

    test("going back to pending stops the clock", () => {
        const c = clock(1000);
        const tracker = new TodoDurations(c.now, format);

        tracker.observe([item(1, "in_progress")]);
        c.tick(300);
        tracker.observe([item(1, "pending")]);
        c.tick(300);
        tracker.observe([item(1, "in_progress")]);
        c.tick(200);

        expect(tracker.observe([item(1, "completed")]).get(1)).toBe("200ms");
    });

    test("removed items are forgotten", () => {
        const c = clock(1000);
        const tracker = new TodoDurations(c.now, format);

        tracker.observe([item(1, "in_progress")]);
        c.tick(100);
        tracker.observe([item(1, "completed")]);
        expect(tracker.get(1)).toBe("100ms");

        tracker.observe([]);
        expect(tracker.get(1)).toBeUndefined();
    });

    test("cancelled or error items are not tracked as finished", () => {
        const tracker = new TodoDurations(clock().now, format);
        const finished = tracker.observe([
            item(1, "cancelled"),
            item(2, "error"),
        ]);
        expect(finished.size).toBe(0);
    });
});
