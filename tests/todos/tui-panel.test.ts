import { describe, expect, test } from "bun:test";
import { continuePrompt, shorten } from "../../src/todos/utils/continue-prompt";
import type { TodoDisplaySummary } from "../../src/todos/utils/display";
import { ERROR_PREFIX, ErrorRowWidth, RowWidth } from "../../src/tui/layout";
import {
  FindActiveEntryIndex,
  NextFollowScrollTop,
  TodoListEntries,
  type TodoListRow,
} from "../../src/tui/todo-panel";

const row = (overrides: Partial<TodoListRow> = {}): TodoListRow => ({
  id: 1,
  content: "Storage",
  icon: "○",
  iconColor: "white",
  textColor: "white",
  depth: 0,
  status: "pending",
  ...overrides,
});

describe("legacy todo panel helpers", () => {
  test("shows expanded error details directly below their row", () => {
    const blocked = row({ status: "error", content: "approval required" });
    const active = row({ id: 1.1, depth: 1, status: "in_progress" });

    expect(TodoListEntries([blocked, active], [1])).toEqual([
      { kind: "row", row: blocked },
      { kind: "error", row: blocked },
      { kind: "row", row: active },
    ]);
    expect(TodoListEntries([blocked, active], [])).toEqual([
      { kind: "row", row: blocked },
      { kind: "row", row: active },
    ]);
  });

  test("finds the active task without counting its expanded error detail", () => {
    const entries = TodoListEntries(
      [
        row({ status: "error" }),
        row({ id: 1.1, depth: 1, status: "in_progress" }),
      ],
      [1],
    );

    expect(FindActiveEntryIndex(entries)).toBe(2);
  });

  test("scrolls only when the active task is outside the viewport", () => {
    expect(
      NextFollowScrollTop({
        currentTop: 0,
        activeIndex: 4,
        rowCount: 10,
        viewportHeight: 4,
      }),
    ).toBe(1);
    expect(
      NextFollowScrollTop({
        currentTop: 2,
        activeIndex: 4,
        rowCount: 10,
        viewportHeight: 4,
      }),
    ).toBeUndefined();
  });
});

describe("Continue prompt", () => {
  const summary: TodoDisplaySummary = {
    header: "Todos (1/4)",
    completed: 1,
    total: 4,
    items: [
      { id: 1, content: "Storage", icon: "○", status: "in_progress", depth: 0 },
      { id: 1.1, content: "schema", icon: "✓", status: "completed", depth: 1 },
      { id: 1.2, content: "store", icon: "○", status: "in_progress", depth: 1 },
      {
        id: 2,
        content: "Wire the tool",
        icon: "○",
        status: "pending",
        depth: 0,
      },
      { id: 3, content: "Verify", icon: "○", status: "pending", depth: 0 },
    ],
  };

  test("lists progress and open items, collapsing excess rows", () => {
    const prompt = continuePrompt(summary);

    expect(prompt).toContain("Progress: 1/4 completed.");
    expect(prompt).toContain("- 1 (currently being worked on) Storage");
    expect(prompt).toContain("  - 1.2 (currently being worked on) store");
    expect(prompt).not.toContain("schema");
    expect(prompt).toContain("... (1 more open item(s))");
  });

  test("handles a missing list without claiming it contains open items", () => {
    expect(continuePrompt(null)).toContain("No open items are listed.");
  });
});

describe("layout widths", () => {
  test("accounts for row prefixes, subtask indentation, and error details", () => {
    expect(RowWidth(row())).toBe(12);
    expect(RowWidth(row({ id: 1.1, content: "schema", depth: 1 }))).toBe(14);
    expect(ErrorRowWidth({ error: "hi", depth: 0 })).toBe(13);
    expect(ErrorRowWidth({ error: "hi", depth: 1 })).toBe(15);
    expect(ERROR_PREFIX).toBe("↳ error: ");
  });
});

describe("shorten", () => {
  test("keeps short text and truncates long text within the requested budget", () => {
    expect(shorten("hello", 10)).toBe("hello");
    expect(shorten("abcdefghijklmnop", 9)).toBe("abcdef...");
  });

  test("trims trailing whitespace before the ellipsis", () => {
    expect(shorten("abcde fghij", 9)).toBe("abcde...");
  });
});
