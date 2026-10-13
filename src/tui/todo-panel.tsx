import { Plugin } from "@opencode/plugin/tui";
import { type ColorInput, ScrollBoxRenderable } from "@opentui/core";
import { mkdirSync, watch } from "node:fs";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { supportsImageRendering } from "../icons/image-capabilities";
import { SvgIcon } from "../icons/svg-icon";
import {
  arrowDownSvgIcon,
  arrowRightSvgIcon,
  continuePromptSvgIcon,
  removeSvgIcon,
} from "../icons/svg-icons";
import { StatusLabel, type TodoStatus } from "../schemas/status";
import {
  getTodosDirectory,
  hashSessionID,
  readTodosSync,
  writeTodos,
} from "../storage/todo-store";
import {
  getTodoDisplaySummary,
  hasOpenTodos,
  type TodoDisplaySummary,
} from "../todos/display";
import { TodoTree } from "../todos/todo-tree";
import { ERROR_PREFIX, ErrorRowWidth, RowWidth } from "./layout";
import { shorten } from "./text";

/** How many open items the Continue prompt lists before collapsing the rest. */
export const CONTINUE_PROMPT_MAX_ITEMS = 3;

/** Per-field caps so one long note cannot flood the prompt. */
export const CONTINUE_PROMPT_MAX_CONTENT = 60;
export const CONTINUE_PROMPT_MAX_NOTE = 60;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 100;
const WATCH_DEBOUNCE_MS = 50;

/**
 * Maximum number of todo rows the panel shows before it starts scrolling.
 * Keeping the panel compact protects the composer; scrolling guarantees no
 * row is ever silently dropped.
 */
export const TODO_PANEL_MAX_ROWS = 8;

export interface TodoListRow {
  id: number;
  content: string;
  icon: string;
  iconColor: ColorInput;
  textColor: ColorInput;
  depth: number;
  status: TodoStatus;
}

/** A renderable line: either a task row or its on-demand error row. */
export type TodoListEntry =
  | { kind: "row"; row: TodoListRow }
  | { kind: "error"; row: TodoListRow };

export interface FollowScrollInput {
  currentTop: number;
  activeIndex: number;
  rowCount: number;
  viewportHeight: number;
}

const isOpen = (status: TodoStatus) =>
  status !== "completed" && status !== "cancelled";

function ContinuePrompt(summary: TodoDisplaySummary | null) {
  const open = summary?.items.filter((item) => isOpen(item.status)) ?? [];
  const shown = open.slice(0, CONTINUE_PROMPT_MAX_ITEMS);
  const hidden = open.length - shown.length;

  const lines = [
    "Continue the current todolist.",
    "First call manage_todo_list [read] and reconcile the stored list with this summary.",
  ];

  if (summary) {
    lines.push(`Progress: ${summary.completed}/${summary.total} completed.`);
  }

  if (open.length) {
    lines.push("Open items that still need work (short summary):");
    for (const item of shown) {
      const note = item.note
        ? ` — ${shorten(item.note, CONTINUE_PROMPT_MAX_NOTE)}`
        : "";
      lines.push(
        `${item.depth ? "  " : ""}- ${item.id} (${StatusLabel[item.status]}) ${shorten(item.content, CONTINUE_PROMPT_MAX_CONTENT)}${note}`,
      );
    }
    if (hidden > 0) lines.push(`... (${hidden} more open item(s))`);
  } else {
    lines.push(
      "No open items are listed. Verify the stored state before stopping.",
    );
  }

  lines.push(
    "Continue the next open item immediately. Keep exactly one item in_progress and update the todo list after verification.",
  );

  return lines.join("\n");
}

/**
 * Flattens rows into renderable lines, inserting an error detail right below
 * an expanded error row (click to toggle).
 */
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

/**
 * Follow the most advanced active row: the last `in_progress` entry is the
 * task currently being executed. Error lines are skipped.
 */
export function FindActiveEntryIndex(entries: TodoListEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === "row" && entry.row.status === "in_progress") {
      return index;
    }
  }
  return -1;
}

/**
 * Scroll offset needed to reveal the active row, or `undefined` when nothing
 * should move (no active row, already visible, or the list fits).
 *
 * Kept pure so the follow behaviour is testable without a live renderer.
 */
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

/**
 * Presentational, context-free todo list.
 *
 * The panel is deliberately chrome-free: no indicator row, and the horizontal
 * scrollbar stays hidden. Long titles never wrap — they are reached by
 * scrolling left/right, and the vertical list scrolls when it exceeds
 * `TODO_PANEL_MAX_ROWS`. When a row is `in_progress` the panel follows it.
 *
 * `activeIcon` is an accessor so the spinner updates only the icon text node
 * instead of forcing every row object to be rebuilt on each animation frame.
 */
export function TodoList(props: {
  rows: TodoListRow[];
  expandedIds?: readonly number[];
  scrollbarColor?: ColorInput;
  activeIcon?: () => string;
  onToggleRow?: (id: number) => void;
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

  const isExpanded = (id: number) => (props.expandedIds ?? []).includes(id);

  return (
    <scrollbox
      ref={attach}
      width="auto"
      height={Math.min(entries().length, TODO_PANEL_MAX_ROWS)}
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
                  if (e.button === 0 && entry.row.status === "error") {
                    e.stopPropagation?.();
                    props.onToggleRow?.(entry.row.id);
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
                  <Show when={entry.row.status === "error"}>
                    <span style={{ fg: props.scrollbarColor }}>
                      {" "}
                      {isExpanded(entry.row.id) ? "⌄" : "›"}
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
                  <span style={{ fg: props.scrollbarColor }}>
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

/** Small helper so each hover target does not repeat three lines. */
function createHover() {
  const [hovered, setHovered] = createSignal(false);
  return {
    hovered,
    onMouseOver: () => setHovered(true),
    onMouseOut: () => setHovered(false),
  };
}

/**
 * Watches the todos directory and calls `onChange` (debounced) when a file
 * belonging to the current session changes. Cleans up with the owner scope.
 */
function watchSessionTodos(sessionID: () => string, onChange: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: ReturnType<typeof watch> | undefined;

  const hashed = createMemo(() => {
    const sid = sessionID();
    if (!sid) return "";
    try {
      return hashSessionID(sid);
    } catch {
      return "";
    }
  });

  const notify = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
  };

  const belongsToSession = (name: string) => {
    const sid = sessionID();
    if (!sid) return true;
    const hash = hashed();
    return (
      (hash !== "" && name.startsWith(hash)) ||
      name.startsWith(sid) ||
      name.startsWith(`todos-${sid}-`)
    );
  };

  try {
    const baseDir = getTodosDirectory();
    mkdirSync(baseDir, { recursive: true });
    watcher = watch(
      baseDir,
      { recursive: true, persistent: false },
      (_, filename) => {
        if (!filename || belongsToSession(String(filename))) notify();
      },
    );
  } catch (err) {
    console.error("[todos] watcher initialization failed:", err);
  }

  onCleanup(() => {
    clearTimeout(timer);
    watcher?.close();
  });
}

export function TodoProgress(props: {
  context: Plugin.Context;
  sessionID: string;
}) {
  // `context` is a stable reference for the lifetime of the plugin, so reading
  // it once is safe. Reactive props below are read through accessors instead.
  const context = props.context;
  const sessionID = () => props.sessionID ?? "";
  const theme = () => context.theme;

  const [refresh, setRefresh] = createSignal(0);
  const [isCollapsed, setIsCollapsed] = createSignal(true);
  const [isContinuePending, setIsContinuePending] = createSignal(false);
  const [animFrame, setAnimFrame] = createSignal(0);
  const [expandedIds, setExpandedIds] = createSignal<number[]>([]);

  const clearHover = createHover();
  const continueHover = createHover();

  // Image capability
  const [imageSupported, setImageSupported] = createSignal(
    supportsImageRendering(context.renderer?.capabilities),
  );
  const onCapabilities = (caps: any) =>
    setImageSupported(supportsImageRendering(caps));
  context.renderer.on("capabilities", onCapabilities);
  onCleanup(() => context.renderer.off("capabilities", onCapabilities));

  // Running state
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
  });

  // Todo data
  watchSessionTodos(sessionID, () => setRefresh((v) => v + 1));

  const summary = createMemo<TodoDisplaySummary | null>(() => {
    refresh();
    const sid = sessionID();
    if (!sid) return null;
    try {
      return getTodoDisplaySummary(readTodosSync(sid));
    } catch {
      return null;
    }
  });

  // Spinner: one interval, only while something is actually running.
  const hasInProgress = createMemo(
    () => summary()?.items.some((i) => i.status === "in_progress") ?? false,
  );

  createEffect(() => {
    if (!(hasInProgress() && isRunning())) return;
    const id = setInterval(
      () => setAnimFrame((prev) => (prev + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL_MS,
    );
    onCleanup(() => clearInterval(id));
  });

  const activeIcon = () => (isRunning() ? SPINNER_FRAMES[animFrame()]! : "-");
  const itemIcon = (status: TodoStatus, fallback: string) =>
    status === "in_progress" ? activeIcon() : fallback;

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

  /**
   * Rows are built only while the panel is expanded and do NOT depend on the
   * spinner frame, so the row objects stay stable between animation ticks.
   */
  const rows = createMemo<TodoListRow[]>(() => {
    if (isCollapsed()) return [];
    return (summary()?.items ?? []).map((item) => ({
      id: item.id,
      content: item.content,
      icon: item.icon,
      iconColor: getStatusColor(item.status),
      textColor: getTextColor(item.status),
      depth: item.depth,
      status: item.status,
    }));
  });

  // Actions
  const toggleRowNote = (id: number) =>
    setExpandedIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );

  const continueTodos = async () => {
    if (isRunning() || isContinuePending()) return;
    const sid = sessionID();
    if (!sid) return;

    setIsContinuePending(true);
    try {
      await context.client.session.prompt({
        sessionID: sid,
        text: ContinuePrompt(summary()),
      });
    } catch (error) {
      setIsContinuePending(false);
      console.error("[todos] continue failed:", error);
    }
  };

  const clearTodos = async () => {
    const sid = sessionID();
    if (!sid) return;
    try {
      await writeTodos(sid, []);
      setRefresh((v) => v + 1);
    } catch (error) {
      console.error("[todos] clear failed:", error);
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
              <box
                flexDirection="row"
                width={2}
                height={1}
                marginRight={1}
                marginLeft={imageSupported() ? 0 : 1}
                alignItems="flex-start"
              >
                <SvgIcon
                  source={isCollapsed() ? arrowRightSvgIcon : arrowDownSvgIcon}
                  color={theme().text.muted}
                  fallback={isCollapsed() ? "▶" : "▼"}
                  width={2}
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
                          {itemIcon(active().status, active().icon)}{" "}
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
                hasOpenTodos(data().items) &&
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
                <SvgIcon
                  source={continuePromptSvgIcon}
                  color={hoverColor(
                    continueHover.hovered(),
                    theme().text.action.primary.base,
                  )}
                  fallback="↻"
                  width={2}
                  height={1}
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
              marginRight={!imageSupported() ? 1.5 : 0}
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
              <SvgIcon
                color={hoverColor(
                  clearHover.hovered(),
                  theme().text.feedback.error.base,
                )}
                source={removeSvgIcon}
                fallback="✖"
                height={1}
                width={2}
              />
            </box>
          </box>

          <Show when={!isCollapsed()}>
            <box flexDirection="column" paddingTop={1} paddingLeft={0.5}>
              <TodoList
                rows={rows()}
                expandedIds={expandedIds()}
                activeIcon={activeIcon}
                onToggleRow={toggleRowNote}
              />
            </box>
          </Show>
        </box>
      )}
    </Show>
  );
}
