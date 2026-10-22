import { TodoTree } from "../todos/todo-tree";

/** Rendered prefix of an error detail row. */
export const ERROR_PREFIX = "↳ error: ";

/**
 * Rendered width of a row: the indentation, the icon cell and the title.
 *
 * Rows must be sized explicitly, otherwise the scroll content never grows
 * wider than the viewport and horizontal scrolling has nothing to move.
 */
export function RowWidth(row: {
    id?: number;
    content: string;
    depth: number;
    elapsed?: string;
    isExpandable?: boolean;
}): number {
    const indent = row.depth > 0 ? 2 : 0;
    const label =
        row.id !== undefined
            ? `${TodoTree.formatIdPrefix(row.id, row.depth)}${row.content}`
            : row.content;
    const extra = row.elapsed ? 1 + [...row.elapsed].length : 0;
    const arrow = row.isExpandable ? 2 : 0;
    // icon glyph + 1 space, then the title, optional elapsed time, and optional collapse arrow.
    return indent + 1 + 1 + [...label].length + extra + arrow;
}

/** Rendered width of an expanded error line under its row. */
export function ErrorRowWidth(row: { error: string; depth: number }): number {
    const indent = row.depth > 0 ? 4 : 2;
    return indent + [...(ERROR_PREFIX + row.error)].length;
}
