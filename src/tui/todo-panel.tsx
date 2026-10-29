import { Plugin } from "@opencode/plugin/tui";
import { ScrollBoxRenderable, type ColorInput } from "@opentui/core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Glyph } from "../icons/glyph";
import { ARROW_DOWN, ARROW_RIGHT, CLEAR, CONTINUE } from "../icons/icons";
import { Todos, watchTodos } from "../rpc";
import type { TodoRootItem } from "../schemas/todo/item";
import { isOpenStatus, type TodoStatus } from "../schemas/todo/status";
import { TodoTree } from "../todos/todotree";
import { continuePrompt, formatElapsed } from "../todos/utils/continue-prompt";
import type { TodoDisplayItem, TodoDisplaySummary } from "../todos/utils/display";
import { getTodoDisplaySummary } from "../todos/utils/display";
import { buildTodoRows } from "../todos/utils/rows";
import { ERROR_PREFIX, ErrorRowWidth, RowWidth } from "./layout";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 100;

export const TODO_PANEL_MAX_ROWS = 8;

export interface TodoListRow {
  id: number;
  content: string;
  icon: string;
  iconColor: ColorInput;
  textColor: ColorInput;
  depth: number;
  status: TodoStatus;
  elapsed?: string;
  isExpandable?: boolean;
}

export type TodoListEntry =
  | { kind: "row"; row: TodoListRow }
  | { kind: "error"; row: TodoListRow };

export interface FollowScrollInput {
  currentTop: number;
  activeIndex: number;
  rowCount: number;
  viewportHeight: number;
}

export function TodoListEntries(
  rows: TodoListRow[],
  expandedIds: readonly number[],
): TodoListEntry[] {
  const expanded = new Set(expandedIds);
  const entries: TodoListEntry[] = [];
  for (const row of rows) {
    entries.push({ kind: "row", row });
    if (row.status === "error" && expanded.has(row.id)) {
      entries.push({ kind: "error", row });
    }
  }
  return entries;
}

export function FindActiveEntryIndex(entries: TodoListEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === "row" && entry.row.status === "in_progress") {
      return index;
    }
  }
  return -1;
}

export function NextFollowScrollTop(
  input: FollowScrollInput,
): number | undefined {
  const { currentTop, activeIndex, rowCount, viewportHeight } = input;
  if (activeIndex < 0) return undefined;

  const viewport = Math.max(1, viewportHeight);
  const maxTop = Math.max(0, rowCount - viewport);
  if (maxTop === 0) return undefined;

  const activeBottom = activeIndex + 1;
  const visibleBottom = currentTop + viewport;

  if (activeIndex >= currentTop && activeBottom <= visibleBottom) {
    return undefined;
  }

  const targetTop =
    activeIndex >= visibleBottom ? activeBottom - viewport : activeIndex;
  return Math.min(Math.max(0, targetTop), maxTop);
}

export function TodoList(props: {
  rows: TodoListRow[];
  expandedIds?: readonly number[];
  scrollbarColor?: ColorInput;
  arrowColor?: ColorInput;
  maxRows?: number;
  activeIcon?: () => string;
  onToggleRow?: (id: number) => void;
  onToggleRoot?: (id: number) => void;
  ref?: (el: ScrollBoxRenderable) => void;
}) {
  const rowId = (id: number) => `todo-row-${id}`;
  const [box, setBox] = createSignal<ScrollBoxRenderable>();

  const entries = createMemo(() =>
    TodoListEntries(props.rows, props.expandedIds ?? []),
  );

  const iconOf = (row: TodoListRow) =>
    row.status === "in_progress"
      ? (props.activeIcon?.() ?? row.icon)
      : row.icon;

  const followActiveRow = (el: ScrollBoxRenderable) => {
    if (el.isDestroyed) return;
    const target = NextFollowScrollTop({
      currentTop: el.scrollTop,
      activeIndex: FindActiveEntryIndex(entries()),
      rowCount: entries().length,
      viewportHeight: el.viewport.height,
    });
    if (target !== undefined) el.scrollTo(target);
  };

  const attach = (el: ScrollBoxRenderable) => {
    setBox(el);
    el.content.maxWidth = undefined;
    const internalOnSizeChange = el.content.onSizeChange;
    el.content.onSizeChange = () => {
      internalOnSizeChange?.call(el.content);
      followActiveRow(el);
    };
    props.ref?.(el);
  };

  // `entries()` already changes whenever rows or expanded ids change.
  createEffect(() => {
    entries();
    const el = box();
    if (el) followActiveRow(el);
  });

  const scrollbarOptions = () =>
    props.scrollbarColor
      ? {
          verticalScrollbarOptions: {
            trackOptions: {
              backgroundColor: props.scrollbarColor,
              foregroundColor: props.scrollbarColor,
            },
          },
        }
      : {};

  return (
    <scrollbox
      ref={attach}
      width="auto"
      height={
        props.maxRows
          ? Math.min(entries().length, props.maxRows)
          : entries().length
      }
      {...scrollbarOptions()}
      horizontalScrollbarOptions={{ visible: false }}
    >
      <box flexDirection="column" flexShrink={0}>
        <For each={entries()}>
          {(entry) =>
            entry.kind === "row" ? (
              <box
                id={rowId(entry.row.id)}
                flexDirection="row"
                height={1}
                flexShrink={0}
                width={RowWidth(entry.row)}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    if (entry.row.status === "error") {
                      e.stopPropagation?.();
                      props.onToggleRow?.(entry.row.id);
                    } else if (entry.row.isExpandable) {
                      e.stopPropagation?.();
                      props.onToggleRoot?.(entry.row.id);
                    }
                  }
                }}
              >
                <text wrapMode="none">
                  <Show when={entry.row.depth > 0}>
                    <span>{"  "}</span>
                  </Show>
                  <span style={{ fg: entry.row.iconColor }}>
                    {iconOf(entry.row)}{" "}
                  </span>
                  <span style={{ fg: entry.row.textColor }}>
                    {TodoTree.formatIdPrefix(entry.row.id, entry.row.depth)}
                  </span>
                  <span
                    style={{
                      fg: entry.row.textColor,
                      strikethrough: entry.row.status === "completed",
                    }}
                  >
                    {entry.row.content}
                  </span>
                  <Show when={entry.row.elapsed}>
                    <span style={{ fg: entry.row.textColor }}>
                      {" "}
                      ({entry.row.elapsed})
                    </span>
                  </Show>
                </text>
              </box>
            ) : (
              <box
                id={`${rowId(entry.row.id)}-note`}
                flexDirection="row"
                height={1}
                flexShrink={0}
                width={ErrorRowWidth({
                  error: entry.row.content,
                  depth: entry.row.depth,
                })}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    e.stopPropagation?.();
                    props.onToggleRow?.(entry.row.id);
                  }
                }}
              >
                <text wrapMode="none">
                  <span
                    style={{ fg: props.arrowColor ?? props.scrollbarColor }}
                  >
                    {entry.row.depth > 0 ? "    " : "  "}
                    {ERROR_PREFIX}
                  </span>
                  <span style={{ fg: entry.row.textColor }}>
                    {entry.row.content}
                  </span>
                </text>
              </box>
            )
          }
        </For>
      </box>
    </scrollbox>
  );
}

function createHover() {
  const [hovered, setHovered] = createSignal(false);
  return {
    hovered,
    onMouseOver: () => setHovered(true),
    onMouseOut: () => setHovered(false),
  };
}

const toggleId = (current: number[], id: number) =>
  current.includes(id)
    ? current.filter((entry) => entry !== id)
    : [...current, id];

export function TodoProgress(props: {
  context: Plugin.Context;
  sessionID: string;
}) {
  const context = props.context;
  const sessionID = () => props.sessionID ?? "";
  const theme = () => context.theme;

  const [todos, setTodos] = createSignal<TodoRootItem[]>([]);

  const refresh = (sid: string) => {
    if (!sid) {
      setTodos([]);
      return;
    }
    void context.client
      .rpc(Todos)
      .read({ sessionID: sid })
      .then((res) => setTodos(res.todos))
      .catch(() => setTodos([]));
  };

  createEffect(() => {
    refresh(sessionID());
  });

  const unsubscribeRpc = watchTodos({
    client: context.client,
    sessionID,
    onChange: refresh,
  });

  const [isCollapsed, setIsCollapsed] = createSignal(false);
  const [isContinuePending, setIsContinuePending] = createSignal(false);
  const [animFrame, setAnimFrame] = createSignal(0);
  const [expandedIds, setExpandedIds] = createSignal<number[]>([]);
  const [manualRootToggles, setManualRootToggles] = createSignal<number[]>([]);
  const taskStartTimes = new Map<number, number>();
  const taskDurations = new Map<number, string>();

  const clearHover = createHover();
  const continueHover = createHover();

  const readRunning = () => {
    const sid = sessionID();
    if (!sid) return false;
    try {
      return context.data.session.status(sid) === "running";
    } catch {
      return false;
    }
  };

  const [isRunning, setIsRunning] = createSignal(readRunning());
  createEffect(() => setIsRunning(readRunning()));

  const unsubscribe = context.data.listen(({ details }) => {
    const sid = sessionID();
    switch (details.type) {
      case "session.execution.started":
      case "session.execution.interrupted":
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.idle":
        if (!sid || details.data.sessionID === sid) {
          setIsRunning(details.type === "session.execution.started");
          setIsContinuePending(false);
        }
        break;
      case "session.status":
        if (!sid || details.data.sessionID === sid) {
          setIsRunning(details.data.status.type !== "idle");
          setIsContinuePending(false);
        }
        break;
    }
  });
  onCleanup(() => {
    try {
      unsubscribe();
    } catch {}
    try {
      unsubscribeRpc();
    } catch {}
  });

  const summary = createMemo<TodoDisplaySummary | null>(() =>
    getTodoDisplaySummary(todos()),
  );

  createEffect(() => {
    const animating =
      isRunning() &&
      (summary()?.items.some((i) => i.status === "in_progress") ?? false);
    if (!animating) return;
    const id = setInterval(
      () => setAnimFrame((prev) => (prev + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL_MS,
    );
    onCleanup(() => clearInterval(id));
  });

  const activeIcon = () => (isRunning() ? SPINNER_FRAMES[animFrame()]! : "-");

  const activeItem = createMemo(() => {
    const items = summary()?.items;
    if (!items) return null;
    return (
      items.find((i) => i.status === "in_progress" && i.depth > 0) ??
      items.find((i) => i.status === "in_progress") ??
      null
    );
  });

  // Colors
  const getStatusColor = (status: TodoStatus) => {
    const t = theme();
    switch (status) {
      case "in_progress":
        return isRunning()
          ? (t.text.action?.primary?.base ??
              t.text.feedback.info?.base ??
              t.text.base)
          : t.text.muted;
      case "completed":
        return t.text.feedback.success.base;
      case "error":
      case "cancelled":
        return t.text.feedback.error.base;
      default:
        return t.text.muted;
    }
  };

  const getTextColor = (status: TodoStatus) =>
    status === "completed" || status === "cancelled" || status === "error"
      ? theme().text.muted
      : theme().text.base;

  const rows = createMemo<TodoListRow[]>(() => {
    if (isCollapsed()) return [];
    const items = summary()?.items ?? [];
    const currentItemIds = new Set(items.map((i) => i.id));

    for (const map of [taskStartTimes, taskDurations]) {
      for (const id of map.keys()) {
        if (!currentItemIds.has(id)) map.delete(id);
      }
    }

    for (const item of items) {
      if (item.status === "in_progress") {
        if (!taskStartTimes.has(item.id)) {
          taskStartTimes.set(item.id, Date.now());
        }
      } else if (item.status === "completed") {
        if (taskStartTimes.has(item.id)) {
          const duration = formatElapsed(
            Date.now() - taskStartTimes.get(item.id)!,
          );
          taskDurations.set(item.id, duration);
          taskStartTimes.delete(item.id);
        }
      } else {
        taskStartTimes.delete(item.id);
      }
    }

    return buildTodoRows(items, manualRootToggles()).map(
      ({ item, expandable }): TodoListRow => ({
        id: item.id,
        content: item.content,
        icon: (item as TodoDisplayItem).icon,
        iconColor: getStatusColor(item.status),
        textColor: getTextColor(item.status),
        depth: item.depth,
        status: item.status,
        elapsed:
          item.status === "completed" ? taskDurations.get(item.id) : undefined,
        isExpandable: expandable,
      }),
    );
  });

  // Actions
  const toggleRowNote = (id: number) =>
    setExpandedIds((current) => toggleId(current, id));

  const toggleRoot = (id: number) =>
    setManualRootToggles((current) => toggleId(current, id));

  const continueTodos = async () => {
    if (isRunning() || isContinuePending()) return;
    const sid = sessionID();
    if (!sid) return;

    setIsContinuePending(true);
    try {
      await context.client.session.prompt({
        sessionID: sid,
        text: continuePrompt(summary()),
      });
    } catch (error) {
      setIsContinuePending(false);
      console.error("[todos] continue failed:", error);
    }
  };

  const showClearError = (message: string) =>
    context.ui.toast.show({
      title: "Clear rejected",
      message,
      variant: "error",
    });

  const clearTodos = async () => {
    const sid = sessionID();
    if (!sid) return;
    try {
      taskStartTimes.clear();
      taskDurations.clear();
      const res = await context.client.rpc(Todos).clear({ sessionID: sid });
      if (!res.ok) {
        showClearError(res.error.message || "Could not clear list.");
        return;
      }
      refresh(sid);
    } catch (error) {
      showClearError(
        (error as { message?: string })?.message ?? "Could not clear list.",
      );
    }
  };

  const hoverColor = (hovered: boolean, active: ColorInput) =>
    hovered ? active : theme().text.muted;

  return (
    <Show when={summary()}>
      {(data) => (
        <box
          flexDirection="column"
          border={true}
          borderStyle="rounded"
          borderColor={theme().border.base}
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexDirection="row" justifyContent="space-between">
            <box
              flexDirection="row"
              flexGrow={1}
              onMouseDown={(e) => {
                if (e.button === 0) {
                  e.stopPropagation();
                  setIsCollapsed((v) => !v);
                }
              }}
            >
              {/* Fixed 2-cell target: one glyph cell plus one blank. Every
                  glyph in `glyphs.ts` is pinned to a single-cell codepoint so
                  layout width, painted width, and the hover hit region agree. */}
              <box
                flexDirection="row"
                width={2}
                height={1}
                marginRight={1}
                marginLeft={1}
                alignItems="flex-start"
              >
                <Glyph
                  glyph={() => (isCollapsed() ? ARROW_RIGHT : ARROW_DOWN)}
                  color={theme().text.muted}
                  height={1}
                />
              </box>

              <box
                flexDirection="row"
                flexGrow={1}
                flexShrink={1}
                overflow="hidden"
                marginRight={1}
              >
                <text wrapMode="none">
                  <span style={{ fg: theme().text.base }}>{"Todos "}</span>
                  <span style={{ fg: theme().text.muted }}>
                    {`(${data().completed}/${data().total})`}
                  </span>
                  <Show when={isCollapsed() && activeItem()}>
                    {(active) => (
                      <>
                        <span style={{ fg: theme().text.muted }}>{"  "}</span>
                        <span style={{ fg: getStatusColor(active().status) }}>
                          {activeIcon()}{" "}
                        </span>
                        <span style={{ fg: getTextColor(active().status) }}>
                          {TodoTree.formatIdPrefix(active().id, active().depth)}
                          {active().content}
                        </span>
                      </>
                    )}
                  </Show>
                </text>
              </box>
            </box>

            <Show
              when={
                data().items.some((i) => isOpenStatus(i.status)) &&
                !isRunning() &&
                !isContinuePending()
              }
            >
              <box
                flexDirection="row"
                gap={1}
                marginRight={3}
                onMouseOver={continueHover.onMouseOver}
                onMouseOut={continueHover.onMouseOut}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    e.stopPropagation();
                    void continueTodos();
                  }
                }}
              >
                <Glyph
                  glyph={() => CONTINUE}
                  color={hoverColor(
                    continueHover.hovered(),
                    theme().text.action.primary.base,
                  )}
                />
                <text
                  wrapMode="none"
                  fg={hoverColor(
                    continueHover.hovered(),
                    theme().text.action.primary.base,
                  )}
                >
                  Continue
                </text>
              </box>
            </Show>
            <box
              marginRight={1.5}
              flexDirection="row"
              onMouseOver={clearHover.onMouseOver}
              onMouseOut={clearHover.onMouseOut}
              onMouseDown={(e) => {
                if (e.button === 0) {
                  e.stopPropagation();
                  void clearTodos();
                }
              }}
            >
              <Glyph
                glyph={() => CLEAR}
                color={hoverColor(
                  clearHover.hovered(),
                  theme().text.feedback.error.base,
                )}
              />
            </box>
          </box>

          <Show when={!isCollapsed()}>
            <box flexDirection="column" paddingTop={1} paddingLeft={0.5}>
              <TodoList
                rows={rows()}
                expandedIds={expandedIds()}
                activeIcon={activeIcon}
                arrowColor={theme().text.muted}
                onToggleRow={toggleRowNote}
                onToggleRoot={toggleRoot}
              />
            </box>
          </Show>
        </box>
      )}
    </Show>
  );
}
