import { describe, expect, test } from "bun:test";
import {
    OperationRejected,
    TodoToolRejection,
    operationErr,
} from "../../src/schemas/rpc/error";

/**
 * An error must survive serialization with its message intact.
 *
 * `Error#message` is non-enumerable, so `JSON.stringify(error)` dropped it and
 * the framework rendered the whole object as "[object Object]". A `toJSON`
 * keeps the message (and the code) in the payload the client actually receives.
 */
const roundTrip = (error: Error) => JSON.parse(JSON.stringify(error));

describe("errors survive serialization", () => {
    test("TodoToolRejection keeps its message through JSON", () => {
        const rejection = new TodoToolRejection({
            code: "item_final",
            message: "1 is 'completed' and locked.",
        });

        const wire = roundTrip(rejection);
        expect(wire.message).toBe("1 is 'completed' and locked.");
        expect(wire.code).toBe("item_final");
    });

    test("the plain JSON shape carries the message, not just the name", () => {
        const rejection = new TodoToolRejection(
            operationErr({
                code: "list_open",
                message: "Cannot clear: 1 todo still open.",
                todos: [],
            }).ok
                ? undefined
                : {
                      code: "list_open",
                      message: "Cannot clear: 1 todo still open.",
                  },
        );

        const wire = JSON.stringify(rejection);
        expect(wire).toContain("Cannot clear: 1 todo still open.");
        expect(wire).not.toContain("[object Object]");
    });

    test("OperationRejected keeps its message through JSON", () => {
        const rejected = new OperationRejected({
            ok: false,
            todos: [],
            error: { code: "not_found", message: "No todo 99." },
        });

        const wire = roundTrip(rejected);
        expect(wire.message).toBe("No todo 99.");
    });

    test("a rejection without an error still serializes a message", () => {
        const rejection = new TodoToolRejection(undefined);

        const wire = roundTrip(rejection);
        expect(typeof wire.message).toBe("string");
        expect(wire.message.length).toBeGreaterThan(0);
    });
});
