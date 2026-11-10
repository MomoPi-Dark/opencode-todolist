import { usePlugin } from "@opencode/plugin/tui";
import type {
  ColorInput,
  MouseEvent,
  ScrollBoxRenderable,
} from "@opentui/core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Glyph } from "../../icons/glyph";
import { ARROW_DOWN, ARROW_RIGHT, CLEAR, CONTINUE } from "../../icons/icons";
import { Todos, type TodoView } from "../../rpc";
import { isOpenStatus, type TodoStatus } from "../../schemas/todo/status";
import { TodoTree } from "../../todos/todotree";
import {
  CLEAR_DIALOG,
  clearDialogAnswer,
} from "../../todos/utils/clear-dialog";
import {
  continuePrompt,
  formatElapsed,
} from "../../todos/utils/continue-prompt";
import { getStatusIcon } from "../../todos/utils/display";
import { TodoDurations } from "../../todos/utils/durations";
import { buildTodoRows } from "../../todos/utils/rows";
import { ERROR_PREFIX, ErrorRowWidth, RowWidth } from "./layout";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 100;

/** The list scrolls instead of growing past this many rows. */
const MAX_VISIBLE_ROWS = 10;

export interface TodoListRow {
  id: number;
  content: string;
  icon: string;
  iconColor: ColorInput;
  textColor: ColorInput;
  depth: number;
  status: TodoStatus;
  note?: string;
  elapsed?: string;
  isExpandable?: boolean;
  collapsed?: boolean;
}

export type TodoListEntry =
  { kind: "row"; row: TodoListRow } | { kind: "error"; row: TodoListRow };

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
    const entry = entries[index];
    if (entry?.kind === "row" && entry.row.status === "in_progress") {
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

function TodoList(props: {
  rows: TodoListRow[];
  expandedIds?: readonly number[];
  arrowColor?: ColorInput;
  errorColor?: ColorInput;
  onToggleRow?: (id: number) => void;
  onToggleRoot?: (id: number) => void;
}) {
  const rowId = (id: number) => `todo-row-${id}`;
  const [box, setBox] = createSignal<ScrollBoxRenderable>();

  const entries = createMemo(() =>
    TodoListEntries(props.rows, props.expandedIds ?? []),
  );

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
  };

  createEffect(() => {
    entries();
    const el = box();
    if (el) followActiveRow(el);
  });

  return (
    <scrollbox
      ref={attach}
      width="auto"
      height={Math.min(entries().length, MAX_VISIBLE_ROWS)}
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
                width={RowWidth({ ...entry.row, chevron: true })}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    e.stopPropagation();
                    if (entry.row.status === "error") {
                      props.onToggleRow?.(entry.row.id);
                    } else if (entry.row.isExpandable) {
                      props.onToggleRoot?.(entry.row.id);
                    }
                  }
                }}
              >
                <text wrapMode="none">
                  <span>{"  "}</span>
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
                  error: entry.row.note ?? entry.row.content,
                  depth: entry.row.depth,
                })}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    e.stopPropagation();
                    props.onToggleRow?.(entry.row.id);
                  }
                }}
              >
                <text wrapMode="none">
                  <span style={{ fg: props.arrowColor }}>
                    {entry.row.depth > 0 ? "    " : "  "}
                    {ERROR_PREFIX}
                  </span>
                  <span style={{ fg: props.errorColor }}>
                    {entry.row.note ?? entry.row.content}
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

const toggled = (list: readonly number[], id: number): readonly number[] =>
  list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

interface Props {
  sessionID: () => string;
  view: () => TodoView | undefined;
  busy: () => boolean;
  onRefresh: () => void;
}

export function TodoPanel(props: Props) {
  const ctx = usePlugin();
  const theme = () => ctx.theme;

  const [isCollapsed, setIsCollapsed] = createSignal(false);
  const [isContinuePending, setIsContinuePending] = createSignal(false);
  const [animFrame, setAnimFrame] = createSignal(0);
  const [expanded, setExpanded] = createSignal<readonly number[]>([]);
  const [manual, setManual] = createSignal<readonly number[]>([]);

  const [hover, setHover] = createSignal<"continue" | "clear">();

  const items = () => props.view()?.items ?? [];
  const hasOpen = () => items().some((item) => isOpenStatus(item.status));

  createEffect(() => {
    const continueVisible = hasOpen() && !props.busy() && !isContinuePending();
    if (!continueVisible && hover() === "continue") setHover();
  });

  const colors = (status: TodoStatus) => {
    const t = theme();
    return {
      text:
        status === "completed" || status === "cancelled" || status === "error"
          ? t.text.muted
          : t.text.base,
      icon:
        status === "in_progress"
          ? props.busy()
            ? t.text.action.primary.base
            : t.text.muted
          : status === "completed"
            ? t.text.feedback.success.base
            : status === "error"
              ? t.text.feedback.error.base
              : t.text.muted,
    };
  };

  const activeIcon = () =>
    props.busy()
      ? (SPINNER_FRAMES[animFrame()] ?? "⠋")
      : getStatusIcon("in_progress");

  createEffect(() => {
    const animating =
      props.busy() && items().some((item) => item.status === "in_progress");
    if (!animating) return;
    const id = setInterval(
      () => setAnimFrame((prev) => (prev + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL_MS,
    );
    onCleanup(() => clearInterval(id));
  });

  const activeItem = createMemo(() => {
    const list = items();
    return (
      list.find((item) => item.status === "in_progress" && item.depth > 0) ??
      list.find((item) => item.status === "in_progress") ??
      null
    );
  });

  const tracker = new TodoDurations(Date.now, formatElapsed);

  const rows = createMemo<TodoListRow[]>(() => {
    const list = items();
    const durations = tracker.observe(list);
    const spinner = activeIcon();

    return buildTodoRows(list, manual()).map(
      ({ item, expandable, collapsed }): TodoListRow => ({
        id: item.id,
        content: item.content,
        icon:
          item.status === "in_progress"
            ? spinner
            : (item.icon ?? getStatusIcon(item.status)),
        iconColor: colors(item.status).icon,
        textColor: colors(item.status).text,
        depth: item.depth,
        status: item.status,
        ...(item.note ? { note: item.note } : {}),
        elapsed: durations.get(item.id),
        isExpandable: expandable,
        collapsed,
      }),
    );
  });

  const continueTodos = async () => {
    const sessionID = props.sessionID();
    const view = props.view();

    if (!sessionID || !view || props.busy() || isContinuePending()) return;

    setIsContinuePending(true);

    try {
      await ctx.client.session.prompt({
        sessionID,
        text: continuePrompt(view),
      });
    } catch (error) {
      ctx.ui.toast.show({
        title: "Could not continue the list",
        message:
          (error as { message?: string }).message ?? "Could not continue.",
        variant: "error",
      });
    } finally {
      setIsContinuePending(false);
    }
  };

  const clearTodos = async () => {
    const sessionID = props.sessionID();
    if (!sessionID) return;

    const ok = await ctx.ui.dialog.confirm({
      title: CLEAR_DIALOG.title,
      message: CLEAR_DIALOG.description,
      label: {
        confirm: CLEAR_DIALOG.acceptLabel,
        cancel: CLEAR_DIALOG.cancelLabel,
      },
    });

    let failure: string | undefined;
    try {
      const res = await ctx.client.rpc(Todos).clear({
        sessionID,
        guard: "disable",
        ui: clearDialogAnswer(ok ?? false),
      });
      if (res.ok) {
        props.onRefresh();
        return;
      }
      if (res.error.code !== "clear_cancelled") {
        failure = res.error.message || "Could not clear the list.";
      }
    } catch (error) {
      failure =
        (error as { message?: string })?.message ?? "Could not clear the list.";
    }

    if (failure !== undefined) {
      ctx.ui.toast.show({
        title: "Could not clear the list",
        message: failure,
        variant: "error",
      });
    }
  };

  const actionColor = (action: "continue" | "clear", active: ColorInput) =>
    hover() === action ? active : theme().text.muted;

  return (
    <Show when={props.view()?.total ? props.view() : undefined}>
      {(data) => (
        <box
          flexDirection="column"
          border={true}
          borderStyle="rounded"
          borderColor={theme().border.base}
        >
          <box
            flexDirection="row"
            justifyContent="space-between"
            paddingLeft={1}
            paddingRight={1}
          >
            <box
              flexDirection="row"
              flexGrow={1}
              onMouseDown={(e) => {
                if (e.button === 0) {
                  e.stopPropagation();
                  setIsCollapsed((value) => !value);
                }
              }}
            >
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
                    {`${data().completed}/${data().total}`}
                  </span>
                  <Show when={isCollapsed() && activeItem()}>
                    {(active) => (
                      <>
                        <span style={{ fg: theme().text.muted }}>{"  "}</span>
                        <span style={{ fg: colors(active().status).icon }}>
                          {activeIcon()}{" "}
                        </span>
                        <span style={{ fg: colors(active().status).text }}>
                          {TodoTree.formatIdPrefix(active().id, active().depth)}
                          {active().content}
                        </span>
                      </>
                    )}
                  </Show>
                </text>
              </box>
            </box>

            <Show when={hasOpen() && !props.busy() && !isContinuePending()}>
              <box
                flexDirection="row"
                gap={1}
                marginRight={3}
                onMouseOver={() => setHover("continue")}
                onMouseOut={() => setHover()}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    e.stopPropagation();
                    void continueTodos();
                  }
                }}
              >
                <Glyph
                  glyph={() => CONTINUE}
                  color={actionColor(
                    "continue",
                    theme().text.action.primary.base,
                  )}
                />
                <text
                  wrapMode="none"
                  fg={actionColor("continue", theme().text.action.primary.base)}
                >
                  Continue
                </text>
              </box>
            </Show>
            <box
              marginRight={1}
              flexDirection="row"
              onMouseOver={() => setHover("clear")}
              onMouseOut={() => setHover()}
              onMouseUp={(e) => {
                if (e.button === 0) {
                  e.stopPropagation();
                  void clearTodos();
                }
              }}
            >
              <Glyph
                glyph={() => CLEAR}
                color={actionColor("clear", theme().text.feedback.error.base)}
              />
            </box>
          </box>

          <Show when={!isCollapsed()}>
            <box flexDirection="column" paddingTop={1}>
              <TodoList
                rows={rows()}
                expandedIds={expanded()}
                arrowColor={theme().text.muted}
                errorColor={theme().text.feedback.error.base}
                onToggleRow={(id) =>
                  setExpanded((current) => toggled(current, id))
                }
                onToggleRoot={(id) =>
                  setManual((current) => toggled(current, id))
                }
              />
            </box>
          </Show>
        </box>
      )}
    </Show>
  );
}
