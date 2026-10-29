import {
  Command,
  ComposerPill,
  createKeyed,
  MenuItem,
  Panel,
  Plugin,
  Slot,
  type PanelTab,
} from "@opencode/plugin/gui";
import { Show, createEffect } from "solid-js";
import { createStore } from "solid-js/store";
import { TodoPanel } from "./gui/todo-panel";
import {
  createTodoSubscription,
  toTodoView,
  type TodoSubscription,
  type TodoView,
} from "./rpc";
import { isOpenStatus } from "./schemas/todo/status";

export default Plugin.define({
  setup(ctx) {
    const panelKey = `${ctx.id}:todos`;
    const [views, setViews] = createStore<Record<string, TodoView | undefined>>(
      {},
    );
    const [busy, setBusy] = createStore<Record<string, boolean>>({});

    let subscription: TodoSubscription | undefined;

    /**
     * The app's own server, resolved reactively. Reading `client` through the
     * server ref (instead of capturing `ctx.client`) is what keeps calls working
     * after the server restarts.
     */
    const server = () =>
      ctx.servers
        .list()
        .map((id) => ctx.servers.get(id))
        .find((entry) => entry?.builtin);

    const refreshBusy = (sessionID: string) => {
      void ctx.client.session
        .active()
        .then((active) => setBusy(sessionID, !!active[sessionID]))
        .catch(() => {});
    };

    /** Re-binds the shared RPC subscription to the given session. */
    const subscribeTodos = (sessionID: string) => {
      subscription?.dispose();
      subscription = createTodoSubscription({
        client: () => server()!.client,
        sessionID: () => sessionID,
        onChange: (todos) => {
          setViews(sessionID, todos ? toTodoView(todos) : undefined);
        },
        onError: () => setViews(sessionID, undefined),
      });
    };

    const refresh = (sessionID: string) => {
      refreshBusy(sessionID);
      subscribeTodos(sessionID);
    };

    createKeyed(() => ctx.sessions.current()?.id, refresh);

    // Subscriptions are live only: events emitted while the connection was down
    // are lost, so reconnect must re-read instead of trusting the last state.
    createEffect(() => {
      const current = server();
      if (!current?.connected) return;
      subscription?.refresh();
    });

    const running = new AbortController();
    void (async () => {
      const events = ctx.client.event.subscribe({
        types: [
          "session.execution.started",
          "session.execution.succeeded",
          "session.execution.failed",
          "session.execution.interrupted",
        ],
        signal: running.signal,
      });
      for await (const event of events) {
        if (event.type === "server.connected") continue;
        setBusy(
          event.data.sessionID,
          event.type === "session.execution.started",
        );
      }
    })().catch(() => {});

    const toggle = () => {
      const session = ctx.sessions.current();
      if (session) ctx.layout.toggle(panelKey, session);
    };

    ctx.add(ComposerPill, {
      id: "progress",
      show: (input) => {
        const view = views[input.session.id];
        if (!view || view.items.length === 0) return undefined;

        const open = view.items.filter((item) =>
          isOpenStatus(item.status),
        ).length;
        const active = view.items.find((item) => item.status === "in_progress");

        return {
          label: `Todos ${view.completed}/${view.total}`,
          icon: "checklist",
          tone: view.items.some((item) => item.status === "error")
            ? "danger"
            : undefined,
          title: active
            ? active.content
            : `${open} open, ${view.total - view.completed} left`,
          run: () => ctx.layout.toggle(panelKey, input.session),
        };
      },
    });

    const currentView = () => {
      const id = ctx.sessions.current()?.id;
      return id ? views[id] : undefined;
    };

    ctx.add(Slot, {
      at: "window.bottom",
      order: 90,
      render: () => (
        <Show when={currentView()}>
          {(view) => (
            <div
              onClick={toggle}
              style={{
                display: "flex",
                "align-items": "center",
                gap: "8px",
                width: "100%",
                padding: "2px 12px",
                "font-size": "var(--font-size-small)",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  display: "flex",
                  "flex-shrink": 0,
                  color: "var(--v2-icon-icon-muted)",
                }}
              >
                <ctx.ui.Icon name="checklist" size="small" />
              </span>
              <span
                style={{ "flex-shrink": 0, color: "var(--v2-text-text-muted)" }}
              >
                Todos {view().completed}/{view().total}
              </span>
              <span
                style={{
                  flex: 1,
                  "min-width": 0,
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                  color: "var(--v2-text-text-base)",
                }}
              >
                {view().items.find((item) => item.status === "in_progress")
                  ?.content ?? ""}
              </span>
            </div>
          )}
        </Show>
      ),
    });

    ctx.add(
      Command,
      (): Command => ({
        id: "toggle",
        title: "Toggle todos",
        keywords: "todo todolist checklist",
        group: "Session",
        section: "session",
        enabled: !!ctx.sessions.current(),
        run: toggle,
      }),
    );

    ctx.add(MenuItem, (): MenuItem => {
      const session = ctx.sessions.current();

      return {
        menu: "session.panel",
        id: "todos",
        title: "Todos",
        icon: "checklist",
        opened: !!session && ctx.layout.state(panelKey, session) !== "closed",
        run: toggle,
      };
    });

    const tab: PanelTab = {
      id: "todos",
      title: "Todos",
      closable: "compact",
      fallback: true,
    };

    ctx.add(Panel, {
      id: "todos",
      region: "side",
      mobile: { title: "Todos", order: 45, kind: "menu", icon: "checklist" },
      list: (input) => (input.open.includes("todos") ? [tab] : []),
      focus: (input) => refresh(input.session.id),
      render: (input) => (
        <TodoPanel
          sessionID={() => input.session.id}
          view={() => views[input.session.id]}
          busy={() => busy[input.session.id] ?? false}
          onRefresh={() => refresh(input.session.id)}
        />
      ),
    });

    return () => {
      running.abort();
      subscription?.dispose();
    };
  },
});
