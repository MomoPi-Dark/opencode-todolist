import { type Plugin, Skill } from "@opencode/plugin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const debug = process.env.TODO_DEBUG === "1";

export interface LocalSkill {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata: Record<string, string>;
  path: string;
  content: string;
}

const unquote = (v: string) => v.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");

/** Parse `<dir>/SKILL.md` according to the OpenCode skill schema. Return null if invalid. */
export function parseSkill(file: string, dirName: string): LocalSkill | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return null;
  }

  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;

  const fields: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  let inMetadata = false;

  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep < 0 || !line.trim() || line.trimStart().startsWith("#")) continue;

    const key = line.slice(0, sep).trim();
    const value = unquote(line.slice(sep + 1));

    if (/^\s/.test(line)) {
      if (inMetadata && value) metadata[key] = value; // child dari `metadata:`
    } else {
      inMetadata = key === "metadata";
      if (value) fields[key] = value;
    }
  }

  const { name, description } = fields;
  const valid =
    name &&
    description &&
    name === dirName &&
    name.length <= 64 &&
    NAME_RE.test(name) &&
    description.length <= 1024;

  if (!valid) {
    if (debug) console.error("[todo] invalid skill, skipped:", file);
    return null;
  }

  return {
    name,
    description,
    license: fields.license,
    compatibility: fields.compatibility,
    metadata,
    path: file,
    content: raw.slice(match[0].length).trim(),
  };
}

export function getSkillsDirectory(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "skills",
  );
}

export function readSkills(dir = getSkillsDirectory()): LocalSkill[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .flatMap(
        (e) => parseSkill(path.join(dir, e.name, "SKILL.md"), e.name) ?? [],
      );
  } catch {
    return [];
  }
}

export async function registerTodoSkills(ctx: Plugin.Context): Promise<void> {
  try {
    const skills = readSkills();
    if (skills.length === 0) return;

    await ctx.skill.transform((editor) => {
      for (const s of skills) {
        editor.add(
          Skill.Info.make({
            id: s.name as Skill.ID,
            name: s.name as Skill.Name,
            description: s.description,
            path: s.path as Skill.Info["path"],
            content: s.content,
            autoinvoke: s.metadata["opencode/autoinvoke"] !== "false",
          }),
        );
      }
    });

    if (debug)
      console.error(
        "[todo] skills registered:",
        skills.map((s) => s.name).join(", "),
      );
  } catch (error) {
    if (debug) console.error("[todo] skill registration failed", error);
  }
}
