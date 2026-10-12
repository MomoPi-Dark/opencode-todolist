import { Plugin } from "@opencode/plugin/tui";
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core";
import { mkdirSync, watch } from "node:fs";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { supportsImageRendering } from "./icons/capabilities";
import { SvgIcon } from "./icons/convert";
import {
  arrowDownSvgIcon,
  arrowRightSvgIcon,
  continuePromptSvgIcon,
  removeSvgIcon,
} from "./icons/icons";
import type { TodoStatus } from "./schema/status.schema";
import {
  getTodosDirectory,
  hashSessionID,
  readTodosSync,
  writeTodos,
} from "./store/store";
import {
  getTodoDisplaySummary,
  hasOpenTodos,
  type TodoDisplayItem,
  type TodoDisplaySummary,
} from "./todo/display";
import { TodoTree } from "./todo/todo";

/** How many open items the Continue prompt lists before collapsing the rest. */
export const CONTINUE_PROMPT_MAX_ITEMS = 3;

/** Per-field caps so one long note cannot flood the prompt. */
export const CONTINUE_PROMPT_MAX_CONTENT = 60;
export const CONTINUE_PROMPT_MAX_NOTE = 60;

/** Truncates to `max` chars, marking the cut with "...". */
function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

export function buildContinuePrompt(
  summary: TodoDisplaySummary | null,
): string {
  const statusLabel: Record<TodoStatus, string> = {
    pending: "not started",
    in_progress: "currently being worked on",
    completed: "completed",
    cancelled: "cancelled",
    error: "needs fixing",
  };
  const open =
    summary?.items.filter(
      ({ status }) => status !== "completed" && status !== "cancelled",
    ) ?? [];
  const shown = open.slice(0, CONTINUE_PROMPT_MAX_ITEMS);
  const hidden = open.length - shown.length;
  const lines = [
    "Continue the current todolist.",
    "First call manage_todo_list [read] and reconcile the stored list with this summary.",
  ];

  if (summary)
    lines.push(`Progress: ${summary.completed}/${summary.total} completed.`);
  if (open.length) {
    lines.push("Open items that still need work (short summary):");
    lines.push(
      ...shown.map(
        (item) =>
          `${item.depth ? "  " : ""}- ${item.id} (${statusLabel[item.status]}) ${shorten(item.content, CONTINUE_PROMPT_MAX_CONTENT)}${item.note ? ` — ${shorten(item.note, CONTINUE_PROMPT_MAX_NOTE)}` : ""}`,
      ),
    );
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

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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

/** Rendered prefix of an error detail row. */
export const ERROR_PREFIX = "↳ error: ";

/** A renderable line: either a task row or its on-demand note row. */
export type TodoListEntry =
  | { kind: "row"; row: TodoListRow }
  | { kind: "error"; row: TodoListRow };

/**
 * Flattens rows into renderable lines, inserting an error detail right below
 * an expanded error row (click to toggle).
 */
export function buildTodoListEntries(
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
 * task currently being executed. Note lines are skipped, they follow their
 * own row.
 */
export function findActiveEntryIndex(entries: TodoListEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === "row" && entry.row.status === "in_progress")
      return index;
  }
  return -1;
}

/**
 * Rendered width of a row: the indentation, the icon cell and the title.
 *
 * Rows must be sized explicitly, otherwise the scroll content never grows
 * wider than the viewport and horizontal scrolling has nothing to move.
 */
export function rowWidth(row: {
  id?: number;
  content: string;
  depth: number;
}): number {
  const indent = row.depth > 0 ? 2 : 0;
  const label =
    row.id !== undefined
      ? `${TodoTree.formatIdPrefix(row.id, row.depth)}${row.content}`
      : row.content;
  // icon glyph + 1 space, then the title.
  return indent + 1 + 1 + [...label].length;
}

/** Rendered width of an expanded error line under its row. */
export function errorRowWidth(row: { error: string; depth: number }): number {
  const indent = row.depth > 0 ? 4 : 2;
  return indent + [...(ERROR_PREFIX + row.error)].length;
}

export interface FollowScrollInput {
  currentTop: number;
  activeIndex: number;
  rowCount: number;
  viewportHeight: number;
}

/**
 * Scroll offset needed to reveal the active row, or `undefined` when nothing
 * should move (no active row, already visible, or the list fits).
 *
 * Kept pure so the follow behaviour is testable without a live renderer.
 */
export function nextFollowScrollTop(
  input: FollowScrollInput,
): number | undefined {
  const { currentTop, activeIndex, rowCount, viewportHeight } = input;
  if (activeIndex < 0) return undefined;

  const viewport = Math.max(1, viewportHeight);
  const maxTop = Math.max(0, rowCount - viewport);
  if (maxTop === 0) return undefined;

  const activeBottom = activeIndex + 1;
  const visibleTop = currentTop;
  const visibleBottom = currentTop + viewport;

  if (activeIndex >= visibleTop && activeBottom <= visibleBottom) {
    return undefined;
  }

  const targetTop =
    activeIndex >= visibleBottom ? activeBottom - viewport : activeIndex;
  return Math.min(Math.max(0, targetTop), maxTop);
}

/**
 * Follow the most advanced active row: the last `in_progress` entry is the
 * task currently being executed.
 */
export function findActiveRowIndex(rows: { status: TodoStatus }[]): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.status === "in_progress") return index;
  }
  return -1;
}

/**
 * Presentational, context-free todo list.
 *
 * The panel is deliberately chrome-free: no indicator row, and the horizontal
 * scrollbar stays hidden. Long titles never wrap (that would break the
 * one-line-per-row layout) — they are reached by scrolling left/right, and the
 * vertical list scrolls when it exceeds `TODO_PANEL_MAX_ROWS`. When a row is
 * `in_progress` the panel follows it so the active task is never out of sight.
 */
export function TodoList(props: {
  rows: TodoListRow[];
  expandedIds?: readonly number[];
  scrollbarColor?: ColorInput;
  onToggleRow?: (id: number) => void;
  ref?: (el: ScrollBoxRenderable) => void;
}) {
  const rowId = (id: number) => `todo-row-${id}`;

  const [scrollYBox, setScrollYBox] = createSignal<ScrollBoxRenderable>();
  const [scrollXBox, setScrollXBox] = createSignal<ScrollBoxRenderable>();

  const entries = createMemo(() =>
    buildTodoListEntries(props.rows, props.expandedIds ?? []),
  );

  const followActiveRow = (box: ScrollBoxRenderable) => {
    if (box.isDestroyed) return;
    const target = nextFollowScrollTop({
      currentTop: box.scrollTop,
      activeIndex: findActiveEntryIndex(entries()),
      rowCount: entries().length,
      viewportHeight: box.viewport.height,
    });
    if (target === undefined) return;
    box.scrollTo(target);
  };

  const attach = (box: ScrollBoxRenderable) => {
    setScrollYBox(box);
    box.content.maxWidth = undefined;
    const internalOnSizeChange = box.content.onSizeChange;
    box.content.onSizeChange = () => {
      internalOnSizeChange?.call(box.content);
      followActiveRow(box);
    };
    props.ref?.(box);
  };

  createEffect(() => {
    void props.rows.map((row) => `${row.id}:${row.status}`).join("|");
    void props.expandedIds?.join("|");
    const box = scrollYBox();
    if (box) followActiveRow(box);
  });

  const scrollbarOptions = () =>
    props.scrollbarColor
      ? {
          trackOptions: {
            backgroundColor: props.scrollbarColor,
            foregroundColor: props.scrollbarColor,
          },
        }
      : undefined;

  const viewportHeight = () => Math.min(entries().length, TODO_PANEL_MAX_ROWS);

  const toggle = (id: number) => {
    props.onToggleRow?.(id);
  };

  return (
    <scrollbox
      ref={(el: ScrollBoxRenderable) => attach(el)}
      width="100%"
      height={viewportHeight()}
      verticalScrollbarOptions={scrollbarOptions()}
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
                width={rowWidth(entry.row)}
                onMouseDown={(e) => {
                  if (e.button === 0 && entry.row.status === "error") {
                    e.stopPropagation?.();
                    toggle(entry.row.id);
                  }
                }}
              >
                <text wrapMode="none">
                  <Show when={entry.row.depth > 0}>
                    <span>{"  "}</span>
                  </Show>
                  <span style={{ fg: entry.row.iconColor }}>
                    {entry.row.icon}{" "}
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
                      {(props.expandedIds ?? []).includes(entry.row.id)
                        ? "⌄"
                        : "›"}
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
                width={errorRowWidth({
                  error: entry.row.content,
                  depth: entry.row.depth,
                })}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    e.stopPropagation?.();
                    toggle(entry.row.id);
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

function TodoProgress(props: { context: Plugin.Context; sessionID: string }) {
  const [refresh, setRefresh] = createSignal(0);

  // Hover
  const [isClearHovered, setIsClearHovered] = createSignal(false);
  const [isContinueHovered, setIsContinueHovered] = createSignal(false);

  const [isCollapsed, setIsCollapsed] = createSignal(true);
  const [isContinuePending, setIsContinuePending] = createSignal(false);
  const [animFrame, setAnimFrame] = createSignal(0);
  const [expandedIds, setExpandedIds] = createSignal<number[]>([]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: ReturnType<typeof watch> | undefined;
  let animTimer: ReturnType<typeof setInterval> | undefined;

  const [imageSupported, setImageSupported] = createSignal(
    supportsImageRendering(props.context.renderer?.capabilities),
  );
  const updateCapabilities = (caps: any) => {
    setImageSupported(supportsImageRendering(caps));
  };
  props.context.renderer?.on?.("capabilities", updateCapabilities);
  onCleanup(() => {
    props.context.renderer?.off?.("capabilities", updateCapabilities);
  });

  const getSessionID = () => props.sessionID ?? "";

  const checkRunning = () => {
    const sid = getSessionID();
    if (!sid) return false;
    try {
      return props.context.data.session.status(sid) === "running";
    } catch {
      return false;
    }
  };

  const [isRunning, setIsRunning] = createSignal(checkRunning());

  const unsubscribe = props.context.data.listen(({ details }) => {
    const sid = getSessionID();
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

  createEffect(() => {
    const sid = getSessionID();
    if (!sid) {
      setIsRunning(false);
      return;
    }
    try {
      setIsRunning(props.context.data.session.status(sid) === "running");
    } catch {
      setIsRunning(false);
    }
  });

  const startAnimation = () => {
    if (animTimer) return;
    animTimer = setInterval(() => {
      setAnimFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 100);
  };

  const stopAnimation = () => {
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = undefined;
    }
  };

  try {
    const baseDir = getTodosDirectory();
    mkdirSync(baseDir, { recursive: true });
    watcher = watch(
      baseDir,
      { recursive: true, persistent: false },
      (_, filename) => {
        const sid = getSessionID();
        if (!filename) {
          clearTimeout(timer);
          timer = setTimeout(() => setRefresh((value) => value + 1), 50);
          return;
        }

        const nameStr = String(filename);
        let hashedSid = "";
        try {
          if (sid) hashedSid = hashSessionID(sid);
        } catch {}

        if (
          !sid ||
          (hashedSid && nameStr.startsWith(hashedSid)) ||
          nameStr.startsWith(sid) ||
          nameStr.startsWith(`todos-${sid}-`)
        ) {
          clearTimeout(timer);
          timer = setTimeout(() => setRefresh((value) => value + 1), 50);
        }
      },
    );
  } catch (err) {
    console.error("[todos] watcher initialization failed:", err);
  }

  onCleanup(() => {
    clearTimeout(timer);
    stopAnimation();
    watcher?.close();
    try {
      unsubscribe();
    } catch {}
  });

  const summary = createMemo<TodoDisplaySummary | null>(() => {
    refresh();
    const sid = getSessionID();
    if (!sid) return null;
    try {
      return getTodoDisplaySummary(readTodosSync(sid));
    } catch {
      return null;
    }
  });

  createEffect(() => {
    const hasInProgress = summary()?.items.some(
      (i) => i.status === "in_progress",
    );
    if (hasInProgress && isRunning()) {
      startAnimation();
    } else {
      stopAnimation();
    }
  });

  const activeItem = createMemo<TodoDisplayItem | null>(() => {
    const d = summary();
    if (!d) return null;
    return (
      d.items.find((i) => i.status === "in_progress" && i.depth > 0) ??
      d.items.find((i) => i.status === "in_progress") ??
      null
    );
  });

  const toggleRowNote = (id: number) => {
    setExpandedIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  };

  const continueTodos = async () => {
    if (isRunning() || isContinuePending()) return;
    const sid = getSessionID();
    if (!sid) return;

    setIsContinuePending(true);
    try {
      await props.context.client.session.prompt({
        sessionID: sid,
        text: buildContinuePrompt(summary()),
      });
    } catch (error) {
      setIsContinuePending(false);
      console.error("[todos] continue failed:", error);
    }
  };

  const getItemIcon = (status: TodoStatus, fallbackIcon: string) => {
    if (status === "in_progress") {
      if (isRunning()) {
        return SPINNER_FRAMES[animFrame()];
      }
      return "-";
    }
    return fallbackIcon;
  };

  const theme = () => props.context.theme;

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
        return t.text.feedback.error.base;
      case "cancelled":
        return t.text.feedback.error.base;
      case "pending":
      default:
        return t.text.muted;
    }
  };

  const getTextColor = (status: TodoStatus) => {
    const t = theme();
    if (
      status === "completed" ||
      status === "cancelled" ||
      status === "error"
    ) {
      return t.text.muted;
    }
    return t.text.base;
  };

  const getBorderColor = () => {
    return theme().border.base;
  };

  return (
    <Show when={summary()}>
      {(data) => (
        <box
          flexDirection="column"
          border={true}
          borderStyle="rounded"
          borderColor={getBorderColor()}
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexDirection="row" justifyContent="space-between">
            <box
              flexDirection="row"
              flexGrow={1}
              onMouseDown={(e) => {
                if (e.button === 0) {
                  e.stopPropagation?.();
                  setIsCollapsed(!isCollapsed());
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
                {isCollapsed() ? (
                  <SvgIcon
                    source={arrowRightSvgIcon}
                    color={theme().text.muted}
                    fallback="▶"
                    width={2}
                    height={1}
                  />
                ) : (
                  <SvgIcon
                    source={arrowDownSvgIcon}
                    color={theme().text.muted}
                    fallback="▼"
                    width={2}
                    height={1}
                  />
                )}
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
                          {getItemIcon(active().status, active().icon)}{" "}
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
                onMouseOver={() => setIsContinueHovered(true)}
                onMouseOut={() => setIsContinueHovered(false)}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    e.stopPropagation();
                    void continueTodos();
                  }
                }}
              >
                <SvgIcon
                  source={continuePromptSvgIcon}
                  color={
                    isContinueHovered()
                      ? theme().text.action.primary.base
                      : theme().text.muted
                  }
                  fallback="↻"
                  width={2}
                  height={1}
                />
                <text
                  wrapMode="none"
                  fg={
                    isContinueHovered()
                      ? theme().text.action.primary.base
                      : theme().text.muted
                  }
                >
                  Continue
                </text>
              </box>
            </Show>

            <box
              marginRight={!imageSupported() ? 1.5 : 0}
              flexDirection="row"
              onMouseOver={() => setIsClearHovered(true)}
              onMouseOut={() => setIsClearHovered(false)}
              onMouseDown={async (e) => {
                if (e.button === 0) {
                  e.stopPropagation();
                  const sid = getSessionID();
                  if (sid) {
                    try {
                      await writeTodos(sid, []);
                      setRefresh((value) => value + 1);
                    } catch (error) {
                      console.error("[todos] clear failed:", error);
                    }
                  }
                }
              }}
            >
              <SvgIcon
                color={
                  isClearHovered()
                    ? theme().text.feedback.error.base
                    : theme().text.muted
                }
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
                rows={data().items.map((item) => ({
                  id: item.id,
                  content: item.content,
                  icon: getItemIcon(item.status, item.icon),
                  iconColor: getStatusColor(item.status),
                  textColor: getTextColor(item.status),
                  depth: item.depth,
                  status: item.status,
                }))}
                expandedIds={expandedIds()}
                onToggleRow={toggleRowNote}
              />
            </box>
          </Show>
        </box>
      )}
    </Show>
  );
}

export default Plugin.define({
  id: "opencode.todolist.tui",
  setup: (context) =>
    context.ui.slot({
      after: "session.composer.top",
      render: (input) => (
        <TodoProgress context={context} sessionID={input.sessionID} />
      ),
    }),
});
