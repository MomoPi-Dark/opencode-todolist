import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const {
    ALL_GLYPHS,
    ARROW_DOWN,
    ARROW_RIGHT,
    CLEAR,
    CONTINUE,
    GLYPH_CODEPOINTS,
    REJECTED_GLYPHS,
} = await import("../src/icons/glyphs.ts");

const { ResolveGlyphBox } = await import("../src/icons/glyph.tsx");

// ---------------------------------------------------------------------------
// Glyph sizing rules
// ---------------------------------------------------------------------------
//
// Precedence: explicit width/height > size shorthand > "auto". Keeping the
// default at "auto" means callers get a correctly sized node for free, and the
// pure helper lets this be verified without a live renderer.

assert.deepEqual(
    ResolveGlyphBox({}),
    { width: "auto", height: "auto" },
    "no sizing props must default to auto on both axes",
);

assert.deepEqual(
    ResolveGlyphBox({ size: 2 }),
    { width: 2, height: 2 },
    "size must set both axes",
);

assert.deepEqual(
    ResolveGlyphBox({ size: 2, width: 3 }),
    { width: 3, height: 2 },
    "explicit width must override size, leaving height from size",
);

assert.deepEqual(
    ResolveGlyphBox({ size: 2, height: 4 }),
    { width: 2, height: 4 },
    "explicit height must override size, leaving width from size",
);

assert.deepEqual(
    ResolveGlyphBox({ width: 1, height: 1 }),
    { width: 1, height: 1 },
    "explicit width and height must both apply",
);

assert.deepEqual(
    ResolveGlyphBox({ size: "auto", width: "50%" }),
    { width: "50%", height: "auto" },
    "percentage and auto values must pass through unchanged",
);

assert.deepEqual(
    ResolveGlyphBox({ fill: true }),
    { width: "100%", height: "100%" },
    "fill must stretch both axes to 100%",
);

assert.deepEqual(
    ResolveGlyphBox({ fill: true, width: 3 }),
    { width: 3, height: "100%" },
    "explicit width must override fill on that axis only",
);

assert.deepEqual(
    ResolveGlyphBox({ fill: true, size: 2 }),
    { width: "100%", height: "100%" },
    "fill must take precedence over size",
);

console.log("✔ glyph box: width/height > fill > size > auto");

// ---------------------------------------------------------------------------
// Shipped glyphs
// ---------------------------------------------------------------------------
//
// The indicators follow OpenCode's own MCP sidebar, which renders
// `<text fg={...}>{open ? "▼" : "▶"}</text>`
// (packages/tui/src/feature-plugins/sidebar/mcp.tsx). Those exact codepoints
// are pinned so a visually similar but poorly supported look-alike cannot be
// substituted unnoticed.
//
// Note for future edits: a bare `fg` attribute on `<text>` IS reactive —
// TextBufferRenderable's fg setter calls requestRender(). Do not "fix" hover by
// moving colours into a nested <span>.

assert.deepEqual(
    {
        ARROW_RIGHT: ARROW_RIGHT.codePointAt(0),
        ARROW_DOWN: ARROW_DOWN.codePointAt(0),
        CONTINUE: CONTINUE.codePointAt(0),
        CLEAR: CLEAR.codePointAt(0),
    },
    GLYPH_CODEPOINTS,
    "glyph codepoints must match the pinned set",
);

for (const [name, glyph] of Object.entries(ALL_GLYPHS)) {
    assert.equal(
        [...glyph].length,
        1,
        `${name} must be a single code point, got ${JSON.stringify(glyph)}`,
    );
    assert.ok(glyph.trim().length > 0, `${name} must not be blank`);
}

// Collapsed and expanded must differ, or the panel cannot show its state.
assert.notEqual(
    ARROW_RIGHT,
    ARROW_DOWN,
    "collapsed and expanded indicators must differ",
);

// The shrunk look-alikes must not come back: the indicator has to read at full
// size in a 2-cell box.
for (const rejected of REJECTED_GLYPHS) {
    assert.ok(
        !Object.values(ALL_GLYPHS).includes(rejected as never),
        `${JSON.stringify(rejected)} is too small for the indicator slot`,
    );
}

console.log("✔ glyphs: pinned codepoints, shrunk look-alikes rejected");

// ---------------------------------------------------------------------------
// Regression: prop reactivity must survive the code as written
// ---------------------------------------------------------------------------
//
// Solid passes props as getters. `const { x } = props` reads once and freezes,
// which is what made the collapsed/expanded arrow stick. Every glyph prop is
// therefore an accessor that is CALLED inside the JSX.

const srcDir = new URL("../src", import.meta.url).pathname;

function collectFiles(dir: string, extensions: string[]): string[] {
    return readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter(
            (entry) =>
                entry.isFile() &&
                extensions.some((ext) => entry.name.endsWith(ext)),
        )
        .map((entry) => join(entry.parentPath ?? dir, entry.name));
}

// Matches `const { ... } = props` and `const { ... } = someProps`.
const DESTRUCTURED_PROPS = /\bconst\s*\{[^}]*\}\s*=\s*\w*[Pp]rops\b/;

const destructured: string[] = [];
for (const file of collectFiles(srcDir, [".tsx"])) {
    const source = readFileSync(file, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
        if (/^\s*\/\//.test(line)) continue;
        if (DESTRUCTURED_PROPS.test(line)) {
            destructured.push(
                `${file.replace(srcDir, "src")}:${index + 1} ${line.trim()}`,
            );
        }
    }
}

assert.deepEqual(
    destructured,
    [],
    `Solid props must not be destructured (reactivity is lost). Use splitProps instead:\n${destructured.join("\n")}`,
);

console.log("✔ no Solid component destructures its props");

// ---------------------------------------------------------------------------
// The built output must keep both reactivity paths
// ---------------------------------------------------------------------------
//
// Checked against dist/ because that is the code OpenCode loads. A `.tsx` file
// run directly is compiled by Bun's own JSX transform, not Solid's, so testing
// source JSX would prove nothing about reactivity.

const builtGlyph = readFileSync(
    new URL("../dist/icons/glyph.js", import.meta.url),
    "utf8",
);
const builtPanel = readFileSync(
    new URL("../dist/tui/todo-panel.js", import.meta.url),
    "utf8",
);

// The compiled text node is inserted through the local `text` accessor, so the
// glyph stays live. Passing a computed string here would freeze it.
assert.ok(
    /_\$insert\(_el\$, text\)/.test(builtGlyph),
    "built Glyph must insert the glyph through an accessor, not a frozen value",
);
assert.ok(
    /const text = \(\) =>/.test(builtGlyph),
    "built Glyph must define the glyph as an accessor",
);
// Colour and both box axes are applied in one reactive effect, so hover colour
// and size changes repaint. TextBufferRenderable's fg setter calls
// requestRender(), matching OpenCode's own mcp.tsx sidebar pattern.
assert.ok(
    /_\$setProp\([^,]+,\s*"fg",\s*_v\$[,)]/.test(builtGlyph),
    "built Glyph must apply colour reactively via the text node fg prop",
);
assert.ok(
    /_\$setProp\([^,]+,\s*"width",\s*_v\$2[,)]/.test(builtGlyph),
    "built Glyph must apply width reactively",
);
assert.ok(
    /_\$setProp\([^,]+,\s*"height",\s*_v\$3[,)]/.test(builtGlyph),
    "built Glyph must apply height reactively",
);
assert.ok(
    !/_createElement\("span"\)/.test(builtGlyph),
    "built Glyph must not wrap the glyph in a span",
);
assert.ok(
    /glyph:\s*\(\)\s*=>\s*isCollapsed\(\)\s*\?\s*ARROW_RIGHT\s*:\s*ARROW_DOWN/.test(
        builtPanel,
    ),
    "built panel must derive the arrow glyph from isCollapsed()",
);
assert.ok(
    builtPanel.includes("ARROW_RIGHT") && builtPanel.includes("ARROW_DOWN"),
    "built panel must reference both arrow glyphs",
);

// The arrow sits in a fixed 2-cell box (glyph cell + blank). A wider glyph
// would push the label, so keep the box in sync with the pinned codepoints.
assert.ok(
    /_\$setProp\([^,]+,\s*"width",\s*2\)/.test(builtPanel) ||
        builtPanel.includes("width: 2"),
    "arrow container must stay a fixed 2-cell box",
);

console.log("✔ built output keeps glyph and color reactivity");

// ---------------------------------------------------------------------------
// Row width calculation
// ---------------------------------------------------------------------------
const { RowWidth } = await import("../src/tui/layout.ts");

// Root item without extra: icon(1) + " "(1) + "1. "(3) + "Title"(5) = 10
assert.equal(
    RowWidth({ id: 1, content: "Title", depth: 0 }),
    10,
    "basic root row width",
);

// Child item with depth 1: indent(2) + icon(1) + " "(1) + "1.1 "(4) + "Subtask"(7) = 15
assert.equal(
    RowWidth({ id: 1.1, content: "Subtask", depth: 1 }),
    15,
    "basic child row width with indentation",
);

// Row with elapsed time: adds " (45s)" which is 1 space + "(" + 3 chars + ")" = 6 chars
assert.equal(
    RowWidth({ id: 1, content: "Title", depth: 0, elapsed: "45s" }),
    16,
    "row width with elapsed time must include parentheses and leading space",
);

console.log("✔ RowWidth accounts for elapsed timer parentheses and depth");

console.log("\n✔ Glyph suite passed");
