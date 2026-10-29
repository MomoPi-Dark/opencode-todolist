import type { OpenCodeClient } from "@opencode/client";
import { Rpc } from "@opencode/plugin/rpc";
import type { TodoRootItem } from "./schemas/todo/item";
import type { TodoDisplayItem } from "./todos/utils/display";
import { TodoTree } from "./todos/todotree";
import { getStatusIcon } from "./todos/utils/display";
import {
    SessionIdSchema,
    TodoRpcClearInputSchema,
    TodoRpcCreateInputSchema,
    TodoRpcReadInputSchema,
    TodoRpcUpdateInputSchema,
} from "./schemas/rpc/input";
import { TodoOperationOutputSchema } from "./schemas/rpc/output";

export const Todos = Rpc.define({
    id: "todos",
    methods: {
        read: {
            input: TodoRpcReadInputSchema,
            output: TodoOperationOutputSchema,
        },
        create: {
            input: TodoRpcCreateInputSchema,
            output: TodoOperationOutputSchema,
        },
        update: {
            input: TodoRpcUpdateInputSchema,
            output: TodoOperationOutputSchema,
        },
        clear: {
            input: TodoRpcClearInputSchema,
            output: TodoOperationOutputSchema,
        },
    },
    events: {
        changed: {
            schema: SessionIdSchema,
        },
    },
});

export interface WatchTodosOptions {
    /**
     * Read at call time. The OpenCode client is replaced after a server restart,
     * so capturing it once would leave the listener bound to a dead client.
     */
    client: () => OpenCodeClient;
    sessionID?: () => string | undefined;
    onChange: (sessionID: string) => void;
}

export function watchTodos(options: WatchTodosOptions): () => void {
    return options.client().rpc(Todos).events.on("changed", (event) => {
        const target = options.sessionID?.();
        if (target === undefined || event.data.sessionID === target) {
            options.onChange(event.data.sessionID);
        }
    });
}

export interface TodoSubscriptionOptions {
    /** Read at call time; same reason as {@link WatchTodosOptions.client}. */
    client: () => OpenCodeClient;
    sessionID: () => string | undefined;
    /** Called with the latest list, or `undefined` when the session is unknown. */
    onChange: (todos: TodoRootItem[] | undefined) => void;
    onError?: (error: unknown) => void;
}

export interface TodoSubscription {
    /**
     * Re-reads now and re-arms the `changed` listener with the current client.
     * Call it after the server reconnects: subscriptions are live only, so
     * events emitted while the connection was down are lost.
     */
    refresh: () => void;
    dispose: () => void;
}

/**
 * One data path for both frontends: initial read, live `changed` events and
 * cleanup. The TUI and the GUI used to each hand-roll this; keeping it in one
 * place is what makes them behave identically.
 *
 * Framework-free on purpose: both panels wire their own reactivity around it.
 */
export function createTodoSubscription(
    options: TodoSubscriptionOptions,
): TodoSubscription {
    let disposed = false;
    let unwatch: (() => void) | undefined;

    const load = (sid: string | undefined) => {
        if (disposed) return;
        if (!sid) {
            options.onChange(undefined);
            return;
        }

        void options.client()
            .rpc(Todos)
            .read({ sessionID: sid })
            .then((res) => {
                if (!disposed) options.onChange(res.ok ? res.todos : undefined);
            })
            .catch((error) => {
                if (!disposed) options.onError?.(error);
            });
    };

    /** Re-reads and re-arms in one step, so the two can never drift apart. */
    const refresh = () => {
        if (disposed) return;

        unwatch?.();
        const sid = options.sessionID();
        load(sid);

        unwatch = watchTodos({
            client: options.client,
            sessionID: options.sessionID,
            onChange: (changedSid) => load(changedSid),
        });
    };

    refresh();

    return {
        refresh,
        dispose: () => {
            disposed = true;
            unwatch?.();
            unwatch = undefined;
        },
    };
}

export type TodoViewItem = TodoDisplayItem;

export interface TodoView {
    completed: number;
    total: number;
    items: TodoViewItem[];
}


export function toTodoView(todos: TodoRootItem[]): TodoView {
    const stats = TodoTree.calculateStats(todos);
    const items: TodoViewItem[] = [];

    for (const parent of todos) {
        items.push({
            id: parent.id,
            content: parent.content,
            icon: getStatusIcon(parent.status),
            status: parent.status,
            depth: 0,
            ...(parent.note ? { note: parent.note } : {}),
        });
        for (const child of parent.children ?? []) {
            items.push({
                id: child.id,
                content: child.content,
                icon: getStatusIcon(child.status),
                status: child.status,
                depth: 1,
                ...(child.note ? { note: child.note } : {}),
            });
        }
    }

    return {
        completed: stats.completedSubTasks,
        total: stats.totalSubTasks,
        items,
    };
}
