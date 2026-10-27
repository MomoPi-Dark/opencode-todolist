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
    expect(content).not.toContain('"scope": "children"');

    const continuation = skill("continue-todolist");
    expect(continuation).toContain('{ "operation": "read" }');
    expect(continuation).toContain('`update`');
    expect(continuation).not.toContain('"operation": "write"');
    expect(continuation).not.toContain('"scope": "children"');
  });

  test("documents the required update array shape", () => {
    const content = skill("todolist");
    expect(content).toContain('"updates": [');
    expect(content).toContain("Update an array of **1–10** updates");
    expect(content).not.toContain("one object or an array");
  });

  test("documents clear confirmation and cancellation rules", () => {
    const content = skill("todolist");
    expect(content).toContain('"confirm": true');
    expect(content).toContain('status: "cancelled"');
    expect(content).toContain("`pending`,");
    expect(content).toContain("`in_progress`,");
    expect(content).toContain("`error` todo");
    expect(content).not.toContain("status: \"error\" or \"cancelled\"");
  });
});
