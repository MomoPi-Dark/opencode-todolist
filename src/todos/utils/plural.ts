/**
 * "3 todos", "1 todo" — one place so every handler and guard agrees.
 */
export const plural = (count: number, word: string): string =>
    `${count} ${word}${count === 1 ? "" : "s"}`;
