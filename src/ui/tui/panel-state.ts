import type { Plugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { TodoRootItem } from "../../schemas/todo/item";
import { createTodoSubscription, type TodoSubscription } from "../../rpc";
import { formatElapsed } from "../../todos/utils/continue-prompt";
import {
  getTodoDisplaySummary,
  type TodoDisplaySummary,
} from "../../todos/utils/display";
import { TodoDurations } from "../../todos/utils/durations";
import { buildTodoRows, type TodoRow } from "../../todos/utils/rows";

/**
 * The non-visual half of the todo panel: the RPC subscription, the expansion
 * state and the derived rows.
 *
 * Anything that reads the theme or returns a renderable element stays in the
 * component; this module only holds state and pure derivation, which keeps the
 * panel's JSX readable.
 */
export interface PanelStateOptions {
  readonly context: Plugin.Context;
  /** The session this panel is bound to; empty when unknown. */
  readonly sessionID: () => string;
}

export interface PanelState {
  readonly todos: () => TodoRootItem[];
  readonly summary: () => TodoDisplaySummary | null;
  readonly expandedIds: () => readonly number[];
  readonly manualRootToggles: () => readonly number[];
  readonly setExpandedIds: (
    next:
      | readonly number[]
      | ((current: readonly number[]) => readonly number[]),
  ) => void;
  readonly setManualRootToggles: (
    next:
      | readonly number[]
      | ((current: readonly number[]) => readonly number[]),
  ) => void;
  /** Rows with collapse applied; the caller attaches elapsed time. */
  readonly rows: () => readonly TodoRow[];
}

/** Applies either a value or an updater, widening the readonly array to a copy. */
const applyNext = (
  next: readonly number[] | ((current: readonly number[]) => readonly number[]),
  current: readonly number[],
): readonly number[] =>
  typeof next === "function" ? [...next(current)] : [...next];

export function createPanelState(options: PanelStateOptions): PanelState {
  const { context, sessionID } = options;

  const [todos, setTodos] = createSignal<TodoRootItem[]>([]);
  const [expandedIds, setExpandedIds] = createSignal<readonly number[]>([]);
  const [manualRootToggles, setManualRootToggles] = createSignal<
    readonly number[]
  >([]);

  // One shared RPC path: initial read plus live `changed` events, re-bound
  // whenever the panel's session changes. The client is read through an
  // accessor because it is replaced after a server restart.
  let subscription: TodoSubscription | undefined;

  createEffect(() => {
    const sid = sessionID();
    subscription?.dispose();

    if (!sid) {
      setTodos([]);
      return;
    }

    subscription = createTodoSubscription(
      { client: () => context.client, sessionID: () => sid },
      {
        onData: (next) => setTodos(next ?? []),
        onError: () => setTodos([]),
      },
    );
  });

  onCleanup(() => subscription?.dispose());

  const summary = createMemo<TodoDisplaySummary | null>(() =>
    getTodoDisplaySummary(todos()),
  );

  // `observe` mutates its own maps, so it stays out of the memo's read set.
  const tracker = new TodoDurations(Date.now, formatElapsed);

  const rows = createMemo<readonly TodoRow[]>(() => {
    const items = summary()?.items ?? [];
    tracker.observe(items);
    return buildTodoRows(items, manualRootToggles());
  });

  return {
    todos,
    summary,
    expandedIds,
    manualRootToggles,
    setExpandedIds: (next) => setExpandedIds(applyNext(next, expandedIds())),
    setManualRootToggles: (next) =>
      setManualRootToggles(applyNext(next, manualRootToggles())),
    rows,
  };
}
