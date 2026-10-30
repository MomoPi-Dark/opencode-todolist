import {
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const outDir = join(root, "dist");

const { transformSolidSource } = await import(
  new URL("./scripts/solid-transform.js", import.meta.resolve("@opentui/solid"))
);

const ARTIFACT = /(\.d\.ts|\.[cm]?[jt]sx?)(\.map)?$/;
const baseOf = (file) => file.replace(ARTIFACT, "");
const read = (path) => readFile(path, "utf8").catch(() => null);
const write = async (path, content) => {
  if ((await read(path)) === content) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return true;
};

const IMPORT = /(from\s+|import\s*\(\s*|import\s+)(["'])(\.{1,2}\/[^"']+)\2/g;
const resolveSpec = async (dir, spec) => {
  if (/\.[cm]?[jt]sx?$/.test(spec))
    return spec.replace(/\.[cm]?[jt]sx?$/, ".js");
  if (/\.[^/]+$/.test(spec)) return spec;
  const isDir = await stat(join(dir, spec)).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
  return isDir ? `${spec}/index.js` : `${spec}.js`;
};
const fixImports = async (path, code) => {
  const dir = dirname(path);
  const resolved = new Map();
  for (const [, , , spec] of code.matchAll(IMPORT))
    if (!resolved.has(spec)) resolved.set(spec, await resolveSpec(dir, spec));
  return code.replace(
    IMPORT,
    (_, pre, q, spec) => `${pre}${q}${resolved.get(spec)}${q}`,
  );
};

let changed = 0;
const srcFiles = await readdir(srcDir, { recursive: true });

// Semua .tsx/.jsx dikompilasi, termasuk gui/
const jsxFiles = srcFiles.filter(
  (f) =>
    /\.[jt]sx$/.test(f) && !f.endsWith(".d.tsx") && !/\.(test|spec)\./.test(f),
);
// `src/gui.tsx` is not shipped as compiled JS: Vite bundles it into
// `dist/gui-experimental.cjs`. The guard has to name the *source* file, since
// that is what the loop below sees.
const VITE_BUNDLED_SOURCES = new Set(["gui.tsx"]);
for (const file of jsxFiles) {
  if (VITE_BUNDLED_SOURCES.has(file)) continue;
  const input = join(srcDir, file);
  const output = join(outDir, file.replace(/\.[jt]sx$/, ".js"));
  const transformed = await transformSolidSource(await read(input), {
    filename: input,
  });
  // Rewrite the relative specifiers before writing, so a single pass produces
  // the final file. Writing the transformed code and fixing it in a later loop
  // made every run report the same changes, because each pass overwrote the
  // other's output.
  const code = await fixImports(output, transformed);
  if (await write(output, code)) changed++;
  for (const ext of [".jsx", ".jsx.map", ".js.map"]) {
    await rm(output.replace(/\.js$/, ext), { force: true });
  }
}

// Leftovers from an earlier build still need their specifiers fixed.
for (const file of await readdir(outDir, { recursive: true })) {
  if (!file.endsWith(".js")) continue;
  const path = join(outDir, file);
  if (await write(path, await fixImports(path, await read(path)))) changed++;
}

const sourceBases = new Set(srcFiles.map(baseOf));
// `gui` is produced by Vite as `gui-experimental.cjs`, so the per-source JS
// emitted by this script would be a stray artifact that must not survive.
for (const source of VITE_BUNDLED_SOURCES) sourceBases.delete(baseOf(source));

const VITE_OUTPUT = new Set(["gui-experimental.cjs"]);
for (const file of await readdir(outDir, { recursive: true })) {
  if (!ARTIFACT.test(file) || sourceBases.has(baseOf(file))) continue;
  if (VITE_OUTPUT.has(file)) continue;
  await rm(join(outDir, file));
  changed++;
  console.log(`🗑️ ${outDir}/${file}`);
  for (let dir = dirname(file); dir !== "."; dir = dirname(dir)) {
    await rmdir(join(outDir, dir)).catch(() => {});
  }
}

console.log(changed ? `Done: ${changed} change(s).` : "Done: no changes.");
