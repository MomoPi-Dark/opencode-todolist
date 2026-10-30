import { describe, expect, test } from "bun:test";

/**
 * Mirrors the TUI's mapping from the dialog answer to "the user said yes".
 *
 * `dialog.confirm()` resolved `true` even when the dialog was dismissed with
 * `x`, so pressing cancel cleared the list. The panel now asks with a select
 * and treats only the explicit `"clear"` choice as consent; every other answer,
 * including a dismissed dialog (`undefined`), keeps the list.
 */
type ClearChoice = "clear" | "cancel";

const confirmed = (answer: ClearChoice | undefined): boolean =>
    answer === "clear";

describe("clear dialog consent", () => {
    test("only the explicit clear choice consents", () => {
        expect(confirmed("clear")).toBe(true);
    });

    test("choosing cancel never consents", () => {
        expect(confirmed("cancel")).toBe(false);
    });

    test("dismissing the dialog never consents", () => {
        // The regression: `x` used to resolve `true`, destroying the list.
        expect(confirmed(undefined)).toBe(false);
    });

    test("an unexpected answer never consents", () => {
        for (const answer of ["", "Clear", "yes", "true"] as const) {
            expect(confirmed(answer as ClearChoice)).toBe(false);
        }
    });
});
