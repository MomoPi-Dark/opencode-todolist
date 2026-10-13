import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

// Reads the real `skills/` folder from disk (no fixtures) and checks every
// skill it finds, so adding, renaming or breaking a skill fails the suite.

const { getSkillsDirectory, parseSkillMarkdown, readSkills } =
    await import("../src/skills/loader.ts");
const { TodoInputToolSchema } = await import("../src/schemas/todo.ts");

const skillsDir = getSkillsDirectory();
assert.ok(existsSync(skillsDir), `skills directory must exist: ${skillsDir}`);

// ---------------------------------------------------------------------------
// 1. Discover skills on disk, independent of the loader
// ---------------------------------------------------------------------------

interface OnDisk {
    id: string;
    file: string;
}

const onDisk: OnDisk[] = readdirSync(skillsDir, {
    withFileTypes: true,
}).flatMap((entry): OnDisk[] => {
    const full = join(skillsDir, entry.name);
    const isDir = statSync(full).isDirectory();
    if (isDir) {
        const file = join(full, "SKILL.md");
        return existsSync(file) ? [{ id: entry.name, file }] : [];
    }
    return entry.name.endsWith(".md")
        ? [{ id: basename(entry.name, ".md"), file: full }]
        : [];
});

assert.ok(onDisk.length >= 1, "at least one skill must ship in skills/");
console.log(`✔ skills/ contains ${onDisk.length} skill(s):`);
for (const { id, file } of onDisk) {
    const raw = readFileSync(file, "utf8");
    console.log(
        `    - ${id} (${raw.split("\n").length} lines, ${raw.length} chars)`,
    );
}

// ---------------------------------------------------------------------------
// 2. The loader must see exactly what is on disk
// ---------------------------------------------------------------------------

const loaded = readSkills();
assert.equal(
    loaded.length,
    onDisk.length,
    `readSkills() found ${loaded.length} skill(s) but ${onDisk.length} exist on disk`,
);
assert.deepEqual(
    loaded.map((s) => s.id).sort(),
    onDisk.map((s) => s.id).sort(),
    "loader and disk must agree on skill ids",
);
console.log("✔ readSkills() returns every skill present on disk");

// ---------------------------------------------------------------------------
// 3. Content checks for each skill
// ---------------------------------------------------------------------------

for (const { id, file } of onDisk) {
    const raw = readFileSync(file, "utf8");
    const parsed = parseSkillMarkdown(raw);
    const label = `[${id}]`;

    // Frontmatter block exists and is closed.
    assert.match(raw, /^---\r?\n[\s\S]*?\r?\n---/, `${label} needs frontmatter`);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)![1]!;

    // name: present and equal to the folder/file id.
    assert.equal(parsed.name, id, `${label} frontmatter name must equal its id`);

    // description: present, single line (the loader is a line parser), sized
    // to be useful when listed for auto-invoke.
    assert.ok(parsed.description, `${label} needs a description`);
    assert.ok(
        parsed.description.length >= 40 && parsed.description.length <= 1024,
        `${label} description length out of range (${parsed.description.length})`,
    );
    assert.ok(
        !/^description:\s*[>|]/m.test(frontmatter),
        `${label} description must be a single line, not a YAML block scalar`,
    );
    assert.match(
        parsed.description,
        /\buse\b|\bwhen\b|\bwhenever\b/i,
        `${label} description should say WHEN to use the skill`,
    );

    // metadata: autoinvoke must be an explicit "true" or "false" string.
    const autoinvoke = parsed.metadata?.["opencode/autoinvoke"];
    assert.ok(
        autoinvoke === "true" || autoinvoke === "false",
        `${label} opencode/autoinvoke must be "true" or "false", got ${String(autoinvoke)}`,
    );

    // Body: non-empty, no leftover frontmatter, balanced code fences.
    assert.ok(parsed.body.length > 200, `${label} body is suspiciously short`);
    assert.ok(
        !parsed.body.startsWith("---"),
        `${label} body must not start with frontmatter`,
    );
    const fences = parsed.body.match(/^```/gm)?.length ?? 0;
    assert.equal(fences % 2, 0, `${label} has an unclosed code fence`);
    assert.ok(
        parsed.body.startsWith("# "),
        `${label} body should start with a top-level title`,
    );

    // Loader output for this skill matches the parse above.
    const fromLoader = loaded.find((s) => s.id === id)!;
    assert.equal(fromLoader.content, parsed.body, `${label} loader body differs`);
    assert.equal(fromLoader.path, file, `${label} loader path differs`);

    console.log(
        `✔ [${id}] frontmatter, description, metadata and body are valid`,
    );
}

// ---------------------------------------------------------------------------
// 4. The shipped todolist skill: content that must stay in sync with the code
// ---------------------------------------------------------------------------

const todolist = loaded.find((s) => s.id === "todolist");
assert.ok(todolist, "the plugin must ship a 'todolist' skill");

assert.equal(
    parseSkillMarkdown(readFileSync(todolist.path, "utf8")).metadata?.[
    "opencode/autoinvoke"
    ],
    "true",
    "todolist must auto-invoke; otherwise the model never loads it",
);

for (const required of [
    "manage_todo_list",
    "in_progress",
    "pending",
    "completed",
    "cancelled",
    "error",
    "operation",
    "## Rules",
    "## Tool Interface",
    "## Context Recovery",
    "## Anti-Patterns",
    "✓  Completed",
    "▶  Starting",
    "✗  Error",
]) {
    assert.ok(
        todolist.content.includes(required),
        `todolist skill must mention "${required}"`,
    );
}
console.log(
    "✔ [todolist] documents the tool, statuses, sections and log lines",
);

// Every ```json example must parse, and `write`/`read` examples must satisfy
// the real tool schema, so the docs cannot drift from the code.
const jsonBlocks = [
    ...todolist.content.matchAll(/```json\n([\s\S]*?)```/g),
].map((m) => m[1]!);
assert.ok(
    jsonBlocks.length >= 3,
    "todolist skill needs read/write/clear examples",
);

let validated = 0;
for (const [i, block] of jsonBlocks.entries()) {
    let value: unknown;
    assert.doesNotThrow(
        () => (value = JSON.parse(block)),
        `json example #${i + 1} must be valid JSON`,
    );
    if (value && typeof value === "object" && "operation" in value) {
        const result = TodoInputToolSchema.safeParse(value);
        assert.ok(
            result.success,
            `json example #${i + 1} must satisfy Schema: ${result.success
                ? ""
                : result.error.issues.map((x) => x.message).join(", ")
            }`,
        );
        validated += 1;
    }
}
assert.ok(validated >= 3, "at least 3 examples must be schema-validated");
console.log(
    `✔ [todolist] ${jsonBlocks.length} json example(s) parse, ${validated} validated against Schema`,
);

console.log(
    `\n✔ skills/ folder suite passed (${onDisk.length} skill(s) checked)`,
);
