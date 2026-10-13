import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const { supportsImageRendering } = await import(
    "../src/icons/image-capabilities.ts"
);

// ---------------------------------------------------------------------------
// supportsImageRendering — decides whether the SVG or the text branch renders
// ---------------------------------------------------------------------------

assert.equal(
    supportsImageRendering(undefined),
    false,
    "unknown capabilities must fall back to text",
);
assert.equal(
    supportsImageRendering(null),
    false,
    "null capabilities must fall back to text",
);
assert.equal(
    supportsImageRendering({
        kitty_graphics: false,
        sixel: false,
    } as never),
    false,
    "a terminal without kitty/sixel must fall back to text",
);
assert.equal(
    supportsImageRendering({
        kitty_graphics: true,
        sixel: false,
    } as never),
    true,
    "kitty graphics terminals render SVG icons",
);
assert.equal(
    supportsImageRendering({
        kitty_graphics: false,
        sixel: true,
    } as never),
    true,
    "sixel terminals render SVG icons",
);
// Windows Terminal reports neither protocol, so it takes the text branch —
// which is exactly the branch whose glyph failed to update.
assert.equal(
    supportsImageRendering({
        kitty_graphics: false,
        sixel: false,
        image_protocol: "blocks",
    } as never),
    false,
    "block-protocol image terminals must not attempt SVG rendering",
);

console.log("✔ supportsImageRendering: text fallback for Windows/plain terminals");

// ---------------------------------------------------------------------------
// Regression: Solid props must never be destructured
// ---------------------------------------------------------------------------
//
// The collapsed `▶` / expanded `▼` glyph froze because SvgIcon did
// `const { fallback } = props`. Solid passes props as getters, so a
// destructuring assignment reads each getter once at creation time and the
// value never updates. The same pattern also froze `source`, `width`, and
// `height`. splitProps (or reading `props.x` inline) keeps them live.

const srcDir = new URL("../src", import.meta.url).pathname;

function collectTsx(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
        .map((entry) => join(entry.parentPath ?? dir, entry.name));
}

// Matches `const { ... } = props` and `const { ... } = someProps`.
const DESTRUCTURED_PROPS = /\bconst\s*\{[^}]*\}\s*=\s*\w*[Pp]rops\b/;

const offenders: string[] = [];
for (const file of collectTsx(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
        // Allow an explicitly commented rationale line to mention the pattern.
        if (/^\s*\/\//.test(line)) continue;
        if (DESTRUCTURED_PROPS.test(line)) {
            offenders.push(`${file.replace(srcDir, "src")}:${index + 1} ${line.trim()}`);
        }
    }
}

assert.deepEqual(
    offenders,
    [],
    `Solid props must not be destructured (reactivity is lost). Use splitProps instead:\n${offenders.join("\n")}`,
);

console.log("✔ no Solid component destructures its props");

// ---------------------------------------------------------------------------
// Regression: the built icon must insert a live accessor, not a static value
// ---------------------------------------------------------------------------

const built = readFileSync(
    new URL("../dist/icons/svg-icon.js", import.meta.url),
    "utf8",
);

assert.ok(
    /splitProps\(props/.test(built),
    "the built SvgIcon must use splitProps to preserve prop reactivity",
);
assert.ok(
    !/_\$insert\([^,]+,\s*fallback\s*\)/.test(built),
    "the built fallback must not be inserted as a frozen value",
);
assert.ok(
    /_\$insert\([^,]+,\s*\(\)\s*=>\s*local\.fallback\s*\)/.test(built),
    "the built fallback must be inserted as a function accessor",
);

console.log("✔ built SvgIcon inserts the fallback through a live accessor");

console.log("\n✔ Icon reactivity suite passed");
