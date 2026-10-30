import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const skill = (name: string) =>
  fs.readFileSync(path.join(root, "skills", name, "SKILL.md"), "utf8");

describe("bundled skill contracts", () => {
  test("documents only supported operations and read scopes", () => {
    const content = skill("todolist");
    expect(content).toContain('"operation": "read"');
    expect(content).toContain('"operation": "update"');
    expect(content).not.toContain('"operation": "write"');
    // `children` is a real scope in the schema, so the docs may show it.
    expect(content).toContain('"scope": "children"');

    const continuation = skill("continue-todolist");
    expect(continuation).toContain('{ "operation": "read" }');
    expect(continuation).toContain("`update`");
    expect(continuation).not.toContain('"operation": "write"');
  });

  test("documents the required update array shape", () => {
    const content = skill("todolist");
    expect(content).toContain('"updates": [');
    expect(content).toContain("Update an array of **1–10** updates");
    expect(content).not.toContain("one object or an array");
  });

  test("documents that a wrong operation is an error", () => {
    const content = skill("todolist");
    // The tool has no `confirm` field any more: the agent asks the user in chat.
    expect(content).not.toContain('"confirm": true');
    expect(content).toContain('{ "operation": "clear" }');
    // Every failure is reported by code, including an empty session.
    expect(content).toContain("`list_empty`");
    expect(content).toContain("`list_open`");
    expect(content).toContain('status: "cancelled"');
    expect(content).not.toContain("status: \"error\" or \"cancelled\"");
  });
});
