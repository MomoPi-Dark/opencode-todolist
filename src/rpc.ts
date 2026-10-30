import type { OpenCodeClient } from "@opencode/client";
import { Rpc } from "@opencode/plugin/rpc";
import {
    SessionIdSchema,
    TodoRpcClearInputSchema,
    TodoRpcCreateInputSchema,
    TodoRpcReadInputSchema,
    TodoRpcUpdateInputSchema,
} from "./schemas/rpc/input";
import { TodoOperationOutputSchema } from "./schemas/rpc/output";
import type { TodoRootItem } from "./schemas/todo/item";
import { TodoTree } from "./todos/todotree";
import { getStatusIcon, type TodoDisplayItem } from "./todos/utils/display";

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

export type TodoClient = Pick<OpenCodeClient, "rpc">;

export interface WatchTodosOptions {
    client: () => TodoClient;
    sessionID?: () => string | undefined;
    onChange: (sessionID: string) => void;
}

export function watchTodos(options: WatchTodosOptions): () => void {
    return options
        .client()
        .rpc(Todos)
        .events.on("changed", (event) => {
            const target = options.sessionID?.();
            if (target === undefined || event.data.sessionID === target) {
                options.onChange(event.data.sessionID);
            }
        });
}

export interface TodoSubscriptionOptions {
    client: () => TodoClient;
    sessionID: () => string | undefined;
}

export interface TodoSubscriptionHandlers {
    onData: (todos: TodoRootItem[] | undefined) => void;
    onError?: (error: unknown) => void;
}

export interface TodoSubscription {
    refresh: () => void;
    dispose: () => void;
}

export function createTodoSubscription(
    options: TodoSubscriptionOptions,
    handlers: TodoSubscriptionHandlers,
): TodoSubscription {
    let disposed = false;
    let unwatch: (() => void) | undefined;

    const load = (sid: string | undefined) => {
        if (disposed) return;
        if (!sid) {
            handlers.onData(undefined);
            return;
        }

        void options
            .client()
            .rpc(Todos)
            .read({ sessionID: sid })
            .then((res) => {
                if (!disposed) handlers.onData(res.ok ? res.todos : undefined);
            })
            .catch((error) => {
                if (!disposed) handlers.onError?.(error);
            });
    };

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
    const items: TodoViewItem[] = [];

    for (const parent of todos) {
        const rootStatus = TodoTree.deriveRootStatus(parent);
        items.push({
            id: parent.id,
            content: parent.content,
            icon: getStatusIcon(rootStatus),
            status: rootStatus,
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
        completed: items.filter((item) => item.status === "completed").length,
        total: items.length,
        items,
    };
}
