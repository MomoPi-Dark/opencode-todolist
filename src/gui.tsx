import {
  Command,
  ComposerPill,
  createKeyed,
  MenuItem,
  Panel,
  Plugin,
  type PanelTab,
} from "@opencode/plugin/gui";
import { createEffect } from "solid-js";
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

    const subscribeTodos = (sessionID: string) => {
      subscription?.dispose();
      subscription = createTodoSubscription(
        {
          client: () => {
            const current = server();
            if (!current) throw new Error("todo panel: no server ref");
            return current.client;
          },
          sessionID: () => sessionID,
        },
        {
          onData: (todos) => {
            setViews(sessionID, todos ? toTodoView(todos) : undefined);
          },
          onError: () => setViews(sessionID, undefined),
        },
      );
    };

    const refresh = (sessionID: string) => {
      refreshBusy(sessionID);
      subscribeTodos(sessionID);
    };

    createKeyed(() => ctx.sessions.current()?.id, refresh);

    let seenConnected: boolean | undefined;
    createEffect(() => {
      const current = server();
      const connected = current?.connected === true;
      const wasConnected = seenConnected;
      seenConnected = connected;
      if (wasConnected === undefined) return;
      if (!connected || wasConnected) return;
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

        const label = `Todos ${view.completed}/${view.total}`;

        const open = view.items.filter((item) =>
          isOpenStatus(item.status),
        ).length;
        const active = view.items.find((item) => item.status === "in_progress");
        const activeContent = busy[input.session.id]
          ? (active?.content ?? "")
          : "";

        return {
          label: `${label} ${activeContent}`,
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

    ctx.add(
      Command,
      (): Command => ({
        id: "toggle",
        title: "Toggle todos",
        keywords: "todo todolist checklist",
        group: "Session",
        section: "session",
        bind: "mod+shift+l",
        enabled: !!ctx.sessions.current(),
        run: toggle,
      }),
    );

    ctx.add(MenuItem, (): MenuItem => {
      const session = ctx.sessions.current();
      const view = session ? views[session?.id] : undefined;
      return {
        menu: "session.panel",
        id: "todos",
        title: "Todos",
        description: view
          ? `You have todos ${view.completed}/${view.total}`
          : undefined,
        icon: "checklist",
        opened: !!session && ctx.layout.state(panelKey, session) !== "closed",
        run: toggle,
        keybind: `${ctx.id}.toggle`,
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
