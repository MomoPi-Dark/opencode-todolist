/** Shorten prompt text without cutting the trailing ellipsis. */
export function shorten(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}
