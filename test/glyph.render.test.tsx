import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { ARROW_DOWN, ARROW_RIGHT, CLEAR } from "../dist/icons/glyphs.js";
// ---------------------------------------------------------------------------
// Glyph render suite
// ---------------------------------------------------------------------------
//
// These checks need a live renderer, so they go through testRender. Two traps
// made earlier attempts report false negatives, and both are handled here:
//
// 1. Inline JSX in a test file is compiled by Bun's own JSX transform, not
//    Solid's. A plain prop such as `color={hovered() ? a : b}` is evaluated
//    once and frozen, so nothing repaints. The component under test is
//    therefore compiled with Solid's real transform (the one
//    scripts/build-jsx.mjs uses) before import.
// 2. Without `--conditions=browser`, `solid-js` resolves to dist/server.js
//    whose reactivity is a no-op. This file is intentionally NOT part of
//    `bun run test`; run it with:
//
//      bun --conditions=browser test/glyph.render.test.ts
//
// The deterministic, renderer-free equivalent lives in test/icon.test.ts.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const fixtureSource = join(here, "fixtures", "hover-glyph.tsx");
const cacheDir = join(here, ".cache");
const compiledFixture = join(cacheDir, "hover-glyph.mjs");

const opentui = import.meta.resolve("@opentui/solid");
// Bun types require a string specifier, so convert the URL first.
const transformSolidSource = (
  await import(new URL("./scripts/solid-transform.js", opentui).href)
).transformSolidSource as (
  code: string,
  options: { filename: string },
) => Promise<string>;

// Compile the fixture with Solid's transform. Its import of the glyph
// component (written against src so typecheck resolves it) is rewritten to the
// COMPILED module, because the transform must run on Solid-compiled input.
await mkdir(cacheDir, { recursive: true });
const glyphModule = pathToFileURL(join(root, "dist", "icons", "glyph.js")).href;
const source = (await readFile(fixtureSource, "utf8")).replace(
  /(["'])\.\.\/\.\.\/src\/icons\/glyph\1/,
  JSON.stringify(glyphModule),
);
const transformed = await transformSolidSource(source, {
  filename: fixtureSource,
});
await writeFile(
  compiledFixture,
  transformed.replace(/\.\.\/icons\/glyph\.js/g, glyphModule),
);

const { HoverGlyph } = await import(pathToFileURL(compiledFixture).href);

const MUTED = "#808080";
const ERROR = "#ff0000";
const MUTED_RGBA = JSON.stringify([128, 128, 128, 255]);
const ERROR_RGBA = JSON.stringify([255, 0, 0, 255]);

type Setup = Awaited<ReturnType<typeof testRender>>;

const fgOf = (out: Setup, needle: string) => {
  const spans = out.captureSpans().lines.flatMap((line: any) => line.spans);
  const span = spans.find((s: any) => s.text.includes(needle));
  if (!span) return "missing";
  const buf = span.fg?.buffer ?? span.fg;
  return buf ? JSON.stringify([buf[0], buf[1], buf[2], buf[3]]) : "no-fg";
};

// ---------------------------------------------------------------------------
// 1. The arrow must change when the collapsed state toggles
// ---------------------------------------------------------------------------

{
  const [collapsed, setCollapsed] = createSignal(true);

  const out = await testRender(
    () => (
      <HoverGlyph
        hovered={() => false}
        glyph={() => (collapsed() ? ARROW_RIGHT : ARROW_DOWN)}
        activeColor={ERROR}
        mutedColor={MUTED}
      />
    ),
    { width: 6, height: 1 },
  );

  await out.flush();
  assert.ok(
    out.captureCharFrame().includes(ARROW_RIGHT),
    `collapsed must render ${ARROW_RIGHT}`,
  );

  setCollapsed(false);
  await out.flush();
  assert.ok(
    out.captureCharFrame().includes(ARROW_DOWN),
    `expanded must render ${ARROW_DOWN}`,
  );

  console.log("✔ render: arrow changes on toggle");
}

// ---------------------------------------------------------------------------
// 2. The colour must repaint on hover (the clear button's path)
// ---------------------------------------------------------------------------

{
  const [hovered, setHovered] = createSignal(false);

  const out = await testRender(
    () => (
      <HoverGlyph
        hovered={hovered}
        glyph={() => CLEAR}
        activeColor={ERROR}
        mutedColor={MUTED}
      />
    ),
    { width: 4, height: 1 },
  );

  await out.flush();
  const before = fgOf(out, CLEAR);
  assert.equal(before, MUTED_RGBA, "idle must use the muted colour");

  setHovered(true);
  await out.flush();
  const after = fgOf(out, CLEAR);
  assert.equal(after, ERROR_RGBA, "hover must repaint with the active colour");

  console.log(`✔ render: hover colour repaints (${before} -> ${after})`);
}

await rm(cacheDir, { recursive: true, force: true });

console.log("\n✔ Glyph render suite passed");
