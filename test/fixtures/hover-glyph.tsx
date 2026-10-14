import { type ColorInput } from "@opentui/core";
import { Glyph } from "../../src/icons/glyph";

/**
 * Test fixture compiled by Solid's own transform before use.
 *
 * Its `color={...}` prop becomes a live getter, mirroring how
 * `src/tui/todo-panel.tsx` passes the hover colour:
 *
 *   get color() {
 *     return hoverColor(clearHover.hovered(), theme().text.feedback.error.base);
 *   }
 *
 * A test file cannot reproduce that shape on its own: Bun compiles test JSX
 * with its own transform, which evaluates `color={expr}` once and freezes it,
 * so a colour change would never repaint. `hovered` and `glyph` arrive as
 * accessors from the test, which Bun passes through untouched.
 */
export function HoverGlyph(props: {
    hovered: () => boolean;
    glyph: () => string;
    activeColor: ColorInput;
    mutedColor: ColorInput;
}) {
    return (
        <Glyph
            glyph={props.glyph}
            color={props.hovered() ? props.activeColor : props.mutedColor}
            height={1}
        />
    );
}
