import { describe, expect, test } from "bun:test";
import { CLEAR_DIALOG, clearDialogAnswer } from "../../src/todos/utils/clear-dialog";
import type { TodoRootItem } from "../../src/schemas/todo/item";
import { handleClear } from "../../src/todos/handlers/clear";

describe("clear dialog copy", () => {
    test("carries a title, a description, two messages and two labels", () => {
        expect(CLEAR_DIALOG.title.length).toBeGreaterThan(0);
        expect(CLEAR_DIALOG.description.length).toBeGreaterThan(0);
        // `accept`/`cancel` are the messages the server echoes back.
        expect(CLEAR_DIALOG.accept).toBe("Clear the list.");
        expect(CLEAR_DIALOG.cancel).toBe("Keep the list as it is.");
        // The buttons carry their own labels.
        expect(CLEAR_DIALOG.acceptLabel).toBe("Clear");
        expect(CLEAR_DIALOG.cancelLabel).toBe("Cancel");
    });

    test("an accepted answer carries the accept message", () => {
        expect(clearDialogAnswer(true)).toEqual({
            confirm: true,
            accept_message: "Clear the list.",
            cancel_message: "Keep the list as it is.",
        });
    });

    test("a refused answer carries the cancel message", () => {
        expect(clearDialogAnswer(false)).toEqual({
            confirm: false,
            accept_message: "Clear the list.",
            cancel_message: "Keep the list as it is.",
        });
    });
});

describe("clear dialog wording reaches the handler", () => {
    const done: TodoRootItem[] = [
        { id: 1, content: "Done", status: "completed" },
    ];

    test("accept_message prefixes the success message", () => {
        const result = handleClear(done, {
            sessionID: "ses_1",
            guard: "disable",
            ui: { confirm: true, accept_message: "Cleared" },
        });

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.content).toContain("Cleared 1 todo.");
    });

    test("a custom accept_message is used verbatim", () => {
        const result = handleClear(done, {
            sessionID: "ses_1",
            guard: "disable",
            ui: { confirm: true, accept_message: "Wiped" },
        });

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.content).toContain("Wiped 1 todo.");
    });

    test("cancel_message becomes the cancellation reason", () => {
        const result = handleClear(done, {
            sessionID: "ses_1",
            guard: "disable",
            ui: { confirm: false, cancel_message: "Cancel" },
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe("clear_cancelled");
            expect(result.error.message).toBe("Cancel");
        }
    });

    test("without a dialog the default wording still applies", () => {
        const result = handleClear(done, { sessionID: "ses_1", guard: "stand" });

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.content).toBe("Cleared 1 todo.");
    });
});
