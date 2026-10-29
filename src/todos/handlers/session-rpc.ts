/**
 * The only capability a session handler needs from the RPC layer: emitting the
 * `changed` event after a committed write.
 *
 * `ctx.rpc(Todos)` is the *client* surface and has no `emit`; emission lives on
 * the registration returned by `ctx.rpc.register(Todos, …)`. Taking this narrow
 * structural type keeps the handlers free of the plugin's Effect types while
 * still making "emit lives in the session handler" true.
 */
export interface TodoSessionRpc {
    readonly events: {
        readonly emit: (
            name: "changed",
            data: { sessionID: string },
        ) => unknown;
    };
}

export const emitChanged = async (
    rpc: TodoSessionRpc,
    sessionID: string,
): Promise<void> => {
    await rpc.events.emit("changed", { sessionID });
};
