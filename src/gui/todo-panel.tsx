import { usePlugin } from "@opencode/plugin/gui";
import { For, Show, createMemo, createSignal } from "solid-js";
import { Todos, type TodoView, type TodoViewItem } from "../rpc";
import { continuePrompt, formatElapsed } from "../todos/utils/continue-prompt";

const STATUS_ICON = {
  pending: "dash",
  in_progress: "dash",
  completed: "circle-check",
  cancelled: "circle-x",
  error: "circle-exclamation",
} as const;

const BASE = "var(--v2-text-text-base)";
const MUTED = "var(--v2-text-text-muted)";
const FAINT = "var(--v2-text-text-faint)";
const DANGER = "var(--v2-state-fg-danger)";

const STATUS_COLOR: Record<TodoViewItem["status"], string> = {
  pending: MUTED,
  in_progress: BASE,
  completed: "var(--v2-state-fg-success)",
  cancelled: FAINT,
  error: DANGER,
};

const OPEN_STATUSES: ReadonlySet<TodoViewItem["status"]> = new Set([
  "pending",
  "in_progress",
  "error",
]);

interface Row {
  item: TodoViewItem;
  elapsed?: string;
  expandable: boolean;
  collapsed: boolean;
}

interface Props {
  sessionID: () => string;
  view: () => TodoView | undefined;
  busy: () => boolean;
  onRefresh: () => void;
}

const toggled = (list: readonly number[], id: number): readonly number[] =>
  list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

export function TodoPanel(props: Props) {
  const ctx = usePlugin();
  const ui = ctx.ui;

  const [expanded, setExpanded] = createSignal<readonly number[]>([]);
  const [manual, setManual] = createSignal<readonly number[]>([]);

  const starts = new Map<number, number>();
  const durations = new Map<number, string>();

  const items = () => props.view()?.items ?? [];
  const hasOpen = () => items().some((item) => OPEN_STATUSES.has(item.status));

  const rows = createMemo<Row[]>(() => {
    const list = items();
    const alive = new Set(list.map((item) => item.id));

    for (const map of [starts, durations]) {
      for (const id of map.keys()) if (!alive.has(id)) map.delete(id);
    }

    for (const item of list) {
      if (item.status === "in_progress") {
        if (!starts.has(item.id)) starts.set(item.id, Date.now());
      } else if (item.status === "completed") {
        const started = starts.get(item.id);
        if (started !== undefined) {
          durations.set(item.id, formatElapsed(Date.now() - started));
          starts.delete(item.id);
        }
      } else {
        starts.delete(item.id);
      }
    }

    const parents = new Set<number>();
    let root: number | undefined;
    for (const item of list) {
      if (item.depth === 0) root = item.id;
      else if (root !== undefined) parents.add(root);
    }

    const out: Row[] = [];
    let skip: number | undefined;

    for (const item of list) {
      let expandable = false;
      let collapsed = false;

      if (item.depth === 0) {
        expandable = parents.has(item.id);
        const defaultCollapsed = item.status === "completed" && expandable;
        collapsed = manual().includes(item.id)
          ? !defaultCollapsed
          : defaultCollapsed;
        skip = collapsed && expandable ? item.id : undefined;
      } else if (skip !== undefined) {
        continue;
      }

      out.push({
        item,
        expandable,
        collapsed,
        elapsed: durations.get(item.id),
      });
    }

    return out;
  });

  const continueTodos = () => {
    const composer = ctx.screen.current()?.composer;
    const view = props.view();
    if (!composer || !view) return;

    // Fill the prompt instead of sending: the desktop user reviews before Enter.
    composer.setText(continuePrompt(view));
    composer.focus();
  };

  const showClearError = (description: string) =>
    ctx.dialogs.alert({ title: "Could not clear the list", description });

  const clearTodos = async () => {
    const sessionID = props.sessionID();
    const ok = await ctx.dialogs.confirm({
      title: "Clear the todo list?",
      description:
        "Every item of this session is removed from the stored list.",
      confirm: "Clear",
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await ctx.client.rpc(Todos).clear({ sessionID });
      if (!res.ok) {
        await showClearError(res.error.message || "Unknown error.");
        return;
      }
    } catch (error) {
      await showClearError(
        (error as { message?: string }).message ?? "Unknown error.",
      );
      return;
    }
    props.onRefresh();
  };

  const isClickable = (row: Row) =>
    row.expandable || row.item.status === "error";

  const activate = (row: Row) => {
    if (row.item.status === "error") {
      setExpanded((current) => toggled(current, row.item.id));
    } else if (row.expandable) {
      setManual((current) => toggled(current, row.item.id));
    }
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        padding: "8px 12px",
        gap: "8px",
        "font-size": "var(--font-size-small)",
      }}
    >
      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <span style={{ "font-weight": "var(--font-weight-medium)" }}>
          Todos
        </span>
        <Show when={props.view()}>
          {(view) => (
            <span style={{ color: MUTED }}>
              {view().completed}/{view().total}
            </span>
          )}
        </Show>
        <span style={{ flex: 1 }} />
        <Show when={hasOpen()}>
          <ui.Tooltip value="Continue the open items">
            <ui.IconButton
              icon="refresh"
              label="Continue todos"
              onClick={continueTodos}
            />
          </ui.Tooltip>
        </Show>
        <Show when={items().length > 0}>
          <ui.Tooltip value="Clear the list">
            <ui.IconButton
              icon="trash"
              label="Clear todos"
              onClick={() => void clearTodos()}
            />
          </ui.Tooltip>
        </Show>
      </div>

      <Show when={props.view()} fallback={<ui.Loader size="small" />}>
        <Show
          when={items().length > 0}
          fallback={
            <p style={{ color: FAINT, margin: "0" }}>
              No todos yet. The agent writes them with manage_todo_list.
            </p>
          }
        >
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "2px",
              overflow: "auto",
              "min-height": "0",
            }}
          >
            <For each={rows()}>
              {(row) => (
                <div>
                  <div
                    onClick={() => activate(row)}
                    style={{
                      display: "flex",
                      "align-items": "flex-start",
                      gap: "6px",
                      "padding-left": row.item.depth > 0 ? "18px" : "0",
                      cursor: isClickable(row) ? "pointer" : "default",
                      opacity:
                        row.item.status === "cancelled" ||
                        row.item.status === "completed"
                          ? 0.65
                          : 1,
                    }}
                  >
                    <span
                      style={{
                        color: MUTED,
                        display: "flex",
                        width: "12px",
                        "flex-shrink": 0,
                      }}
                    >
                      <Show when={row.expandable}>
                        <ui.Icon
                          name={
                            row.collapsed ? "chevron-right" : "chevron-down"
                          }
                          size="small"
                        />
                      </Show>
                    </span>
                    <span
                      style={{
                        color: STATUS_COLOR[row.item.status],
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        width: "14px",
                        "flex-shrink": 0,
                      }}
                    >
                      {/* Spins only while the session works; an idle list keeps the static icon. */}
                      <Show
                        when={props.busy() && row.item.status === "in_progress"}
                        fallback={
                          <ui.Icon
                            name={STATUS_ICON[row.item.status]}
                            size="small"
                          />
                        }
                      >
                        <ui.Loader size="small" />
                      </Show>
                    </span>
                    <span style={{ color: FAINT, "flex-shrink": 0 }}>
                      {row.item.id}
                    </span>
                    <span
                      style={{
                        color: row.item.status === "in_progress" ? BASE : MUTED,
                        "text-decoration":
                          row.item.status === "completed"
                            ? "line-through"
                            : undefined,
                        "overflow-wrap": "anywhere",
                      }}
                    >
                      {row.item.content}
                    </span>
                    <Show when={row.elapsed}>
                      {(elapsed) => (
                        <span style={{ color: FAINT }}>({elapsed()})</span>
                      )}
                    </Show>
                  </div>

                  <Show
                    when={
                      row.item.status === "error" &&
                      expanded().includes(row.item.id)
                    }
                  >
                    <div
                      style={{
                        color: DANGER,
                        "padding-left": "54px",
                        "overflow-wrap": "anywhere",
                      }}
                    >
                      {row.item.note ?? row.item.content}
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
