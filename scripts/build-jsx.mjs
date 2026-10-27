import {
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
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
const baseOf = (file) => file.replace(ARTIFACT, ""); // "a/b.js.map" -> "a/b"
const read = (path) => readFile(path, "utf8").catch(() => null);
const write = async (path, content) => {
  if ((await read(path)) === content) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return true;
};
const fixImports = (code) =>
  code.replace(
    /(from\s+|import\s*\(\s*|import\s+)(["'])(\.{1,2}\/[^"']+)\2/g,
    (_, pre, q, spec) => {
      const next = /\.[cm]?[jt]sx?$/.test(spec)
        ? spec.replace(/\.[cm]?[jt]sx?$/, ".js")
        : /\.[^/]+$/.test(spec)
          ? spec
          : `${spec}.js`;
      return `${pre}${q}${next}${q}`;
    },
  );
let changed = 0;
const srcFiles = await readdir(srcDir, { recursive: true });
const jsxFiles = srcFiles.filter(
  (f) =>
    /\.[jt]sx$/.test(f) && !f.endsWith(".d.tsx") && !/\.(test|spec)\./.test(f),
);
for (const file of jsxFiles) {
  const input = join(srcDir, file);
  const output = join(outDir, file.replace(/\.[jt]sx$/, ".js"));
  const code = await transformSolidSource(await read(input), {
    filename: input,
  });
  if (await write(output, code)) changed++;
  for (const ext of [".jsx", ".jsx.map", ".js.map"]) {
    await rm(output.replace(/\.js$/, ext), { force: true });
  }
}
for (const file of await readdir(outDir, { recursive: true })) {
  if (!file.endsWith(".js")) continue;
  const path = join(outDir, file);
  if (await write(path, fixImports(await read(path)))) changed++;
}
const sourceBases = new Set(srcFiles.map(baseOf));
for (const file of await readdir(outDir, { recursive: true })) {
  if (!ARTIFACT.test(file) || sourceBases.has(baseOf(file))) continue;
  await rm(join(outDir, file));
  changed++;
  console.log(`🗑️ dist/${file}`);
  for (let dir = dirname(file); dir !== "."; dir = dirname(dir)) {
    await rmdir(join(outDir, dir)).catch(() => {});
  }
}
// for (const name of ["index", "tui"]) {
//   const wrapper = join(root, `${name}.js`);
//   const content = `export { default } from "./dist/${name}.js";`;
//   if (await read(join(outDir, `${name}.js`))) {
//     if (await write(wrapper, content)) changed++;
//   } else if ((await read(wrapper)) === content) {
//     await rm(wrapper);
//     changed++;
//   }
// }
console.log(changed ? `Done: ${changed} change(s).` : "Done: no changes.");
