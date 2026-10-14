import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Drizzle Kit configuration.
 *
 * `drizzle-kit generate` reads this to emit SQL into `drizzle/`. The runtime
 * never uses this file: it applies the generated SQL through
 * `drizzle-orm/bun-sqlite/migrator` (see `src/storage/db.ts`), so the folder
 * `drizzle/` must ship with the package.
 *
 * `dbCredentials` is required by the commands that actually touch a database —
 * `migrate`, `studio`, `check` — even though `generate` does not need it. The
 * path mirrors the store's own resolution so tooling inspects the real file
 * instead of a stray default. `OPENCODE_TODOS_DIR` wins, exactly as it does at
 * runtime, so a dev can point both at a scratch directory.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/storage/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: join(
      process.env.OPENCODE_TODOS_DIR ??
      join(homedir(), ".opencode", "sessions"),
      "todos.db",
    ),
  },
});
