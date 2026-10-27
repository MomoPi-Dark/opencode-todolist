import z from "zod";

export const MAX_CONTENT = 500;
export const MAX_NOTE = 1000;
export const MAX_ROOTS = 50;
export const MAX_CHILDREN = 9;

export const contentField = z.string().trim().min(1).max(MAX_CONTENT);
export const noteField = z
    .string()
    .max(MAX_NOTE)
    .describe("Optional free-form note for this todo.");
