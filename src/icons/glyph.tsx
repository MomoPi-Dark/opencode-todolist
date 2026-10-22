import { type ColorInput } from "@opentui/core";

/** Cell size accepted by the layout engine. */
export type GlyphSize = number | "auto" | `${number}%`;

export type GlyphProps = {
    /**
     * The glyph to draw. Pass a function to keep it reactive (the arrow depends
     * on `isCollapsed()`), or a plain string for a fixed symbol.
     */
    glyph: (() => string) | string;
    color?: ColorInput;
    /** Shortcut: stretch to `100%` on both axes (fill the parent). */
    fill?: boolean;
    /** Shorthand that sets both `width` and `height`. */
    size?: GlyphSize;
    /** Horizontal cells; overrides `fill` and `size`. Defaults to `"auto"`. */
    width?: GlyphSize;
    /** Vertical cells; overrides `fill` and `size`. Defaults to `"auto"`. */
    height?: GlyphSize;
};

export type GlyphBox = {
    readonly width: GlyphSize;
    readonly height: GlyphSize;
};

/**
 * Resolves the box for a glyph.
 *
 * Precedence per axis: `width`/`height` > `fill` (100%) > `size` > `"auto"`.
 *
 * The default is `"auto"`, so the zero-configuration case fills exactly what
 * the glyph needs. `fill` switches both axes to `100%` in one word, which is
 * the simple "just stretch to whatever space there is" form.
 *
 * Kept pure so the rules are testable without a live renderer.
 */
export function ResolveGlyphBox(props: {
    fill?: boolean;
    size?: GlyphSize;
    width?: GlyphSize;
    height?: GlyphSize;
}): GlyphBox {
    const fillSize: GlyphSize = "100%";
    return {
        width: props.width ?? (props.fill ? fillSize : undefined) ?? props.size ?? "auto",
        height:
            props.height ?? (props.fill ? fillSize : undefined) ?? props.size ?? "auto",
    };
}

/**
 * A colored terminal glyph in a single text node.
 *
 * Matches OpenCode's own MCP sidebar, which renders
 * `<text fg={...}>{open ? "▼" : "▶"}</text>`
 * (packages/tui/src/feature-plugins/sidebar/mcp.tsx). A `fg` attribute on
 * `<text>` is reactive: TextBufferRenderable's fg setter calls requestRender().
 *
 * `glyph` accepts either an accessor or a plain string. Solid hands components
 * getters, so an accessor stays live while a string is simply constant.
 *
 * Sizing: `width` and `height` default to `"auto"`. `fill` stretches both axes
 * to `100%` in one word, `size` sets a square box, and explicit `width`/`height`
 * win over both.
 *
 * A terminal cannot scale a character — a glyph always paints in one cell, so
 * `size`/`fill` reserve layout space rather than enlarging the symbol. To make a
 * control read as larger, give it a bigger box (or use the SVG icon path where
 * the terminal supports images).
 */
export function Glyph(props: GlyphProps) {
    const text = () => {
        const glyph = props.glyph;
        return typeof glyph === "function" ? glyph() : glyph;
    };
    const box = () => ResolveGlyphBox(props);

    return (
        <text
            wrapMode="none"
            fg={props.color}
            width={box().width}
            height={box().height}
        >
            {text()}
        </text>
    );
}

