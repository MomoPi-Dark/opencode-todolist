/**
 * Terminal glyphs for the TUI widget.
 *
 * These are plain Unicode characters rather than rendered SVG images. Terminal
 * image protocols (Kitty, Sixel) are advertised inconsistently — Termius, for
 * example, advertises Kitty support but fails to load the payload — so a
 * capability probe can select an image branch that never actually renders and
 * never falls back.
 *
 * Reference: OpenCode's own MCP sidebar uses exactly this shape
 * (`packages/tui/src/feature-plugins/sidebar/mcp.tsx`):
 *
 *   <text fg={theme.text.base}>{view.open ? "▼" : "▶"}</text>
 *
 * A terminal cannot scale a character: one code point paints in one cell, so
 * `size`/`width`/`height` on a glyph reserve layout space and never enlarge the
 * symbol. To make an indicator look bigger it must be drawn from several cells
 * (block art) or rendered as an image on terminals that support it.
 */

/** Collapsed indicator. */
export const ARROW_RIGHT = "▶";

/** Expanded indicator. */
export const ARROW_DOWN = "▼";

/** Continue action. */
export const CONTINUE = "↻";

/** Clear action. */
export const CLEAR = "⨯";

export const ALL_GLYPHS = {
    ARROW_RIGHT,
    ARROW_DOWN,
    CONTINUE,
    CLEAR,
} as const;

/**
 * Exact codepoints shipped. Pinned so tests catch an accidental swap to a
 * visually similar character that may not exist in every terminal font.
 *
 * Update these whenever a glyph above changes; the test compares the two.
 */
export const GLYPH_CODEPOINTS = {
    ARROW_RIGHT: 0x25b6, // ▶
    ARROW_DOWN: 0x25bc, // ▼
    CONTINUE: 0x21bb, // ↻
    CLEAR: 0x2a2f, // ⨯
} as const;

/**
 * Rejected look-alikes: characters that are visually similar but too small or
 * not universally available in terminal fonts. Kept so a regression cannot
 * quietly reintroduce a shrunk indicator.
 */
export const REJECTED_GLYPHS = [
    "▸", // U+25B8 small triangle, too small at this size
    "▾", // U+25BE small triangle, too small at this size
    "▷", // U+25B7 outline triangle, too small
    "◁", // U+25C1 outline triangle, too small
] as const;
