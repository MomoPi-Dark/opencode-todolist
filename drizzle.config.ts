import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const xdgDataHome = process.env.XDG_DATA_HOME;
const base =
  process.env.OPENCODE_TODOS_DIR ??
  (xdgDataHome && isAbsolute(xdgDataHome)
    ? join(xdgDataHome, "opencode", "todolist")
    : join(homedir(), ".local", "share", "opencode", "todolist"));

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/storage/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: join(base, "todos.db"),
  },
});
