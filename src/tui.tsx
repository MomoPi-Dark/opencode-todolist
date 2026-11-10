import { Plugin } from "@opencode/plugin/tui";
import { onCleanup } from "solid-js";
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
    const todoSubs = new Map<
      string,
      { subscription: TodoSubscription; count: number }
    >();

    const [views, setViews] = createStore<Record<string, TodoView | undefined>>(
      {},
    );
    const [busy, setBusy] = createStore<Record<string, boolean>>({});

    const refreshBusy = (sessionID: string) => {
      void ctx.client.session
        .active()
        .then((active) => setBusy(sessionID, !!active[sessionID]))
        .catch(() => {});
    };

    const subscribeTodos = (sessionID: string) => {
      return createTodoSubscription(
        {
          client: () => ctx.client,
          sessionID: () => sessionID,
        },
        {
          onData: (todos) =>
            setViews(sessionID, todos ? toTodoView(todos) : undefined),
          onError: () => setViews(sessionID, undefined),
        },
      );
    };

    const acquire = (sessionID: string): (() => void) => {
      let entry = todoSubs.get(sessionID);

      if (entry) {
        entry.count += 1;
      } else {
        entry = {
          subscription: subscribeTodos(sessionID),
          count: 1,
        };
        todoSubs.set(sessionID, entry);
        refreshBusy(sessionID);
      }

      const owned = entry;
      let released = false;

      return () => {
        if (released) return;
        released = true;

        owned.count -= 1;
        if (owned.count > 0) return;

        if (todoSubs.get(sessionID) === owned) {
          todoSubs.delete(sessionID);
          setViews(sessionID, undefined);
        }

        owned.subscription.dispose();
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
    (async () => {
      const events = ctx.client.event.subscribe({
        types: BUSY_EVENT_TYPES,
        signal: running.signal,
      });
      for await (const event of events) {
        const busyEvent = asBusyEvent(event);
        const isBusy = busyEvent && nextBusy(busyEvent);
        if (isBusy !== undefined && busyEvent)
          setBusy(busyEvent.sessionID, isBusy);
      }
    })().catch(() => {});

    const releaseSlot = ctx.ui.slot({
      append: "session.composer.top",
      render: (props) => {
        const sessionID = props.sessionID;

        onCleanup(acquire(sessionID));

        return (
          <TodoPanel
            sessionID={() => sessionID}
            view={() => views[sessionID]}
            busy={() => busy[sessionID] ?? false}
            onRefresh={() => refresh(sessionID)}
          />
        );
      },
    });

    return () => {
      running.abort();
      todoSubs.forEach((entry) => entry.subscription.dispose());
      todoSubs.clear();
      releaseSlot();
    };
  },
});
