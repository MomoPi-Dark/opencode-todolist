import { Plugin } from "@opencode/plugin/tui";
import { createEffect, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import {
  createTodoSubscription,
  TodoSubscription,
  TodoView,
  toTodoView,
} from "./rpc";
import { asBusyEvent, nextBusy } from "./ui/busy";
import { BUSY_EVENT_TYPES } from "./ui/events";
import { TodoPanel } from "./ui/tui/todo-panel";

export default Plugin.define({
  id: "todolist.tui",
  setup(ctx) {
    const [views, setViews] = createStore<Record<string, TodoView | undefined>>(
      {},
    );
    const [busy, setBusy] = createStore<Record<string, boolean>>({});

    const todoSubs = new Map<
      string,
      { subscription: TodoSubscription; count: number }
    >();

    const refreshBusy = (id: string) => {
      void ctx.client.session
        .active()
        .then((active) => setBusy(id, !!active[id]))
        .catch(() => {});
    };

    const subscribeTodos = (id: string): TodoSubscription =>
      createTodoSubscription(
        {
          client: () => ctx.client,
          sessionID: () => id,
        },
        {
          onData: (todos) => {
            setViews(id, todos ? toTodoView(todos) : undefined);
          },
          onError: () => {
            setViews(id, undefined);
          },
        },
      );

    const acquire = (id: string): (() => void) => {
      let entry = todoSubs.get(id);
      if (entry) {
        entry.count += 1;
      } else {
        entry = { subscription: subscribeTodos(id), count: 1 };
        todoSubs.set(id, entry);
      }
      refreshBusy(id);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        const current = todoSubs.get(id);
        if (!current) return;
        current.count -= 1;
        if (current.count <= 0) {
          current.subscription.dispose();
          todoSubs.delete(id);
          setViews(id, undefined);
        }
      };
    };

    const refresh = (id: string) => {
      refreshBusy(id);
      const entry = todoSubs.get(id);
      if (!entry) return;
      entry.subscription.dispose();
      entry.subscription = subscribeTodos(id);
    };

    const running = new AbortController();
    void (async () => {
      const events = ctx.client.event.subscribe({
        types: BUSY_EVENT_TYPES,
        signal: running.signal,
      });
      for await (const event of events) {
        const busyEvent = asBusyEvent(event);
        if (!busyEvent) continue;
        const isBusy = nextBusy(busyEvent);
        if (isBusy === undefined) continue;
        setBusy(busyEvent.sessionID, isBusy);
      }
    })().catch(() => {});

    const releaseSlot = ctx.ui.slot({
      append: "session.composer.top",
      render: (props) => {
        const sessionID = () => props.sessionID as string;

        createEffect(() => {
          const id = sessionID();
          if (!id) return;
          onCleanup(acquire(id));
        });

        return (
          <TodoPanel
            sessionID={sessionID}
            view={() => views[sessionID()]}
            busy={() => busy[sessionID()] ?? false}
            onRefresh={() => refresh(sessionID())}
          />
        );
      },
    });

    return () => {
      releaseSlot();
      running.abort();
      for (const { subscription } of todoSubs.values()) subscription.dispose();
      todoSubs.clear();
    };
  },
});
