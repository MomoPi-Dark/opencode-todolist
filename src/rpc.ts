import type { OpenCodeClient } from "@opencode/client";
import { Rpc } from "@opencode/plugin/rpc";
import type { TodoRootItem } from "./schemas/todo/item";
import type { TodoStatus } from "./schemas/todo/status";
import { TodoTree } from "./todos/todotree";
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
    client: OpenCodeClient;
    sessionID?: () => string | undefined;
    onChange: (sessionID: string) => void;
}

export function watchTodos(options: WatchTodosOptions): () => void {
    return options.client.rpc(Todos).events.on("changed", (event) => {
        const target = options.sessionID?.();
        if (target === undefined || event.data.sessionID === target) {
            options.onChange(event.data.sessionID);
        }
    });
}

export interface TodoViewItem {
    id: number;
    content: string;
    status: TodoStatus;
    depth: number;
    note?: string;
}

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
            status: parent.status,
            depth: 0,
            ...(parent.note ? { note: parent.note } : {}),
        });
        for (const child of parent.children ?? []) {
            items.push({
                id: child.id,
                content: child.content,
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
