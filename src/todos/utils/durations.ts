import type { TodoStatus } from "../../schemas/todo/status";

export interface DurationTracked {
  id: number;
  status: TodoStatus;
}

/**
 * Tracks how long each todo spent `in_progress`, so both panels can show the
 * same elapsed time without duplicating the bookkeeping.
 *
 * The clock is injected so the whole thing is unit-testable: callers pass
 * `Date.now` in production and a controllable stub in tests.
 */
export class TodoDurations {
  private readonly starts = new Map<number, number>();
  private readonly finished = new Map<number, string>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly format: (ms: number) => string = (ms) => `${ms}ms`,
  ) {}

  /** Feeds the current list and returns the elapsed text for finished items. */
  observe(items: readonly DurationTracked[]): ReadonlyMap<number, string> {
    const alive = new Set(items.map((item) => item.id));

    for (const id of this.starts.keys()) {
      if (!alive.has(id)) this.starts.delete(id);
    }
    for (const id of this.finished.keys()) {
      if (!alive.has(id)) this.finished.delete(id);
    }

    for (const item of items) {
      if (item.status === "in_progress") {
        if (!this.starts.has(item.id)) this.starts.set(item.id, this.now());
        continue;
      }

      if (item.status === "completed") {
        const started = this.starts.get(item.id);
        if (started !== undefined) {
          this.finished.set(item.id, this.format(this.now() - started));
          this.starts.delete(item.id);
        }
        continue;
      }

      // Anything else stops the clock: the item is no longer being worked on.
      this.starts.delete(item.id);
    }

    return this.finished;
  }

  get(id: number): string | undefined {
    return this.finished.get(id);
  }
}
