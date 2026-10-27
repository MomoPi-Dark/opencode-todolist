import type { TodoRootItem } from "../../schemas/todo/item";
import type { TodoUpdateInput } from "../../schemas/todo/update";
import { updateTodos } from "../../storage/todo-store";
import { TodoRules, type TodoRuleError } from "../rules";
import { formatWriteOutput } from "./formatText";

class UpdateRejected extends Error {
    constructor(
        readonly rule: TodoRuleError,
        readonly index: number,
        readonly total: number,
    ) {
        super(`Update ${index + 1} of ${total} (id ${rule.id}) rejected: ${rule.message}`);
        this.name = "UpdateRejected";
    }
}

export async function handleUpdate(sessionID: string, data: TodoUpdateInput) {
    let before: TodoRootItem[] = [];

    try {
        const todos = await updateTodos(sessionID, (current) => {
            before = current;
            const applied = TodoRules.apply(current, data.updates);
            if (!applied.ok) {
                throw new UpdateRejected(
                    applied.error,
                    applied.index,
                    data.updates.length,
                );
            }
            return applied.todos;
        });

        return {
            ok: true as const,
            todos,
            content: formatWriteOutput(todos, before),
        };
    } catch (error) {
        if (!(error instanceof UpdateRejected)) throw error;
        return {
            ok: false as const,
            code: error.rule.code,
            message: error.message,
            todos: before,
        };
    }
}
