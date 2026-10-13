import { type Plugin, Skill } from "@opencode/plugin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ParsedSkill {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  body: string;
}

export interface LocalSkill {
  id: string;
  name: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  path: string;
  content: string;
}

const unquote = (value: string): string => {
  const v = value.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(v);
  return quoted ? (quoted[2] ?? v) : v;
};

export function parseSkillMarkdown(input: string): ParsedSkill {
  const raw = input.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) return { body: raw.trim() };

  const parsed: ParsedSkill = { body: raw.slice(match[0].length).trim() };
  const lines = (match[1] ?? "").split(/\r?\n/);
  let inMetadata = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = unquote(line.slice(separator + 1));

    if (/^\s/.test(line)) {
      if (inMetadata && value) (parsed.metadata ??= {})[key] = value;
      continue;
    }

    inMetadata = key.toLowerCase() === "metadata";

    if (/^[>|][+-]?$/.test(value)) {
      const folded = value.startsWith(">");
      const block: string[] = [];
      while (
        i + 1 < lines.length &&
        (!lines[i + 1]?.trim() || /^\s/.test(lines[i + 1] ?? ""))
      ) {
        block.push((lines[++i] ?? "").trim());
      }
      value = block.filter(Boolean).join(folded ? " " : "\n");
    }

    if (!value) continue;

    switch (key.toLowerCase()) {
      case "name":
        parsed.name = value;
        break;
      case "description":
        parsed.description = value;
        break;
      case "license":
        parsed.license = value;
        break;
      case "compatibility":
        parsed.compatibility = value;
        break;
    }
  }
  return parsed;
}

export function parseSkillFile(file: string): ParsedSkill | null {
  try {
    return parseSkillMarkdown(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function getSkillsDirectory(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(moduleDir, "..", "..", "skills")];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0] ?? "";
}

function isDirectoryEntry(dir: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(dir, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

export function readSkills(dir: string = getSkillsDirectory()): LocalSkill[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const isDir = isDirectoryEntry(dir, entry);
      const candidates = isDir
        ? [
          path.join(dir, entry.name, "SKILL.md"),
          path.join(dir, entry.name, `${entry.name}.md`),
        ]
        : path.extname(entry.name) === ".md"
          ? [path.join(dir, entry.name)]
          : [];

      for (const file of candidates) {
        const parsed = parseSkillFile(file);
        if (!parsed) continue;
        const id = isDir ? entry.name : path.basename(entry.name, ".md");
        return [
          {
            id,
            name: parsed.name || id,
            description: parsed.description,
            license: parsed.license,
            compatibility: parsed.compatibility,
            metadata: parsed.metadata,
            path: file,
            content: parsed.body,
          },
        ];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export async function registerTodoSkills(ctx: Plugin.Context): Promise<void> {
  const debug = process.env.TODO_HINT_DEBUG === "1";
  try {
    const skills = readSkills();
    if (skills.length === 0) {
      if (debug) {
        console.error("[todo] no skills found in", getSkillsDirectory());
      }
      return;
    }

    await ctx.skill.transform((editor) => {
      for (const skill of skills) {
        editor.add(
          Skill.Info.make({
            id: skill.id as Skill.ID,
            name: skill.name as Skill.Name,
            path: skill.path as Skill.Info["path"],
            content: skill.content,
            autoinvoke: skill.metadata?.["opencode/autoinvoke"] !== "false",
            ...(skill.description ? { description: skill.description } : {}),
          }),
        );
      }
    });

    if (debug) {
      console.error(
        "[todo] skills registered:",
        skills.map((s) => s.id).join(", "),
      );
    }
  } catch (error) {
    if (debug) console.error("[todo] skill registration failed", error);
  }
}
