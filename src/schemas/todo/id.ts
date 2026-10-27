import z from "zod";

/**
 * Accepts `"1"` as well as `1`.
 *
 * Models routinely send numeric ids as JSON strings, and the JSON Schema handed
 * to the provider declares `integer`, so a quoted id would otherwise be rejected
 * by the runtime before `execute` ever sees it. Coercion has to happen here —
 * in the schema the runtime validates against — not inside the handler.
 *
 * `z.preprocess` is used instead of `z.coerce.number()` on purpose: `coerce`
 * turns `true` into `1` and rewrites the emitted JSON Schema to a bare
 * `type: integer`, which loses the `anyOf` branch descriptions the model reads.
 * A preprocess step keeps both branch schemas intact.
 */
const ROOT_ID_RE = /^\d+$/;
const NUMERIC_ID_RE = /^\d+(\.\d+)?$/;

const numericId = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    const v = value.trim();
    return NUMERIC_ID_RE.test(v) ? Number(v) : value;
};

// Root ids coerce only from digit-only strings: "1" -> 1.
// "1.0", "1.1", "1e0" and "0x1" stay strings and fail z.number().
const rootNumericId = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    const v = value.trim();
    return ROOT_ID_RE.test(v) ? Number(v) : value;
};

/**
 * Root id format: <root_id> as number -> 1, 2, etc.
 * A top-level id only: `1`, `2`, ... — never a dotted subtask id.
 */
export const RootIdSchema = z.preprocess(
    rootNumericId,
    z
        .number({ error: "Root id must be a whole number like 1 (no dots)" })
        .int({
            error: "Root id must be a whole number like 1; use 1.1 only for subtasks",
        })
        .positive()
        .describe("Unique task identifier (e.g. 1)"),
);

/**
 * Child id format: <root_id>.<n> as a number -> 1.1, 2.3, etc.
 * Only a single decimal digit (1-9) is allowed, see the note below.
 */
export const ChildIdSchema = z.preprocess(
    numericId,
    z
        .number()
        .refine((n) => /^[1-9]\d*\.[1-9]$/.test(String(n)), {
            message:
                "Child id must follow the format <root_id>.<n> with n from 1 to 9, e.g. 1.1",
        })
        .describe("Unique subtask identifier, format <root_id>.<n> (e.g. 1.1)"),
);

/**
 * Root or child id, composed from the two schemas above so the id rules
 * live in exactly one place. The union carries its own message so a bad id
 * reports the expected shape instead of zod's generic "Invalid input".
 */
export const TodoTargetIdSchema = z
    .union([RootIdSchema, ChildIdSchema], {
        error:
            "id must be a number like 1 (root) or 1.1 (subtask); remove the quotes",
    })
    .describe("Root or child todo id, e.g. 1 or 1.1");
