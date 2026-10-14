# AGENTS.md

Context and operational rules for agents working on `opencode-sidebar-modern-todolist`.

## Project Overview

OpenCode plugin providing a hierarchical todo list engine (`manage_todo_list` tool), automatic skill registration, prompt injection hook, and real-time SolidJS terminal widget for the OpenTUI sidebar.

- **Runtime**: Bun (>= 1.3.0) + Node.js (>= 24/26)
- **Language**: TypeScript (`strict: true`)
- **Key dependencies**: `@opencode/plugin`, `@opentui/core`, `@opentui/solid`, `solid-js` (pinned to `1.9.12` to prevent peer conflicts), `zod`, `drizzle-orm`, `@resvg/resvg-js`.

## Essential Commands

All commands should be executed with Bun:

- **Typecheck**: `bun run typecheck` (`tsc --noEmit`)
- **Run all checks**: `bun run check` (typecheck then every test suite)
- **Compile build artifacts**: `bun run compile` (`tsc -p tsconfig.build.json && node scripts/build-jsx.mjs`)
- **Run icon/reactivity test**: `bun test/icon.test.ts`
- **Run skill parser tests**: `bun test/skill.test.ts`
- **Run skill content/schema test**: `bun test/skill.folder.test.ts`
- **Run core todo test**: `bun test/todo.test.ts` (currently fully commented out)

> **Note on test runner**: Do not use `bun test test/*.test.ts` as test files use Node's `node:assert` and custom runners rather than Bun's native BDD describe blocks. Execute test files directly with `bun <file>`.

> **`test/icon.test.ts` requires a fresh build.** It asserts against
> `dist/icons/svg-icon.js`, so run `bun run compile` before it. It also fails if
> any component destructures its props, which silently breaks Solid reactivity.

## Build Artifacts & Git Distribution

`dist/`, `index.js`, and `tui.js` are **gitignored** and intentionally not tracked.
They are produced by the `prepare` script (`bun run compile`) and distributed through
the npm tarball, whose `files` allowlist ships the built `dist/` directory.

Three install paths, all verified:

| Path | How `dist/` is produced |
| --- | --- |
| `git clone` + `bun install` (README flow) | `prepare` runs `bun run compile` |
| `opencode plugin add <spec>` | npm tarball already contains `dist/` |
| `npm publish` | `prepare` runs locally before packing the tarball |

> **Do not rely on `prepare` for `opencode plugin add`.** OpenCode installs packages
> with `@npmcli/arborist` configured with `ignoreScripts: true`
> (`packages/util/src/npm.ts`), so lifecycle scripts are skipped. The published
> tarball must therefore contain the built `dist/`.

`exports` mapping in `package.json`:
- `.` -> `./dist/index.js`
- `./tui` -> `./dist/tui.js`

Root `index.js` and `tui.js` re-export from `./dist/` with **explicit `.js` extensions**
to support older loader resolutions and OpenCode's dependency scanner.

**Workflow after modifying `src/`**:
1. `bun run check`
2. `bun run compile`
3. Verify no `.jsx` remains in `dist/` before publishing.

### Why every relative import must end in `.js`

OpenCode fingerprints a local plugin by scanning its imports with `Bun.Transpiler`,
then resolving each one with `Bun.resolveSync` (`packages/plugin/src/source.bun.ts`).
Bun prefers `.jsx` over `.js` when a specifier omits its extension. If `tsc` leaves a
stale `dist/tui.jsx` next to the Solid-compiled `dist/tui.js`, Bun loads the raw JSX
file instead — which fails to compile against `@opentui/solid` and surfaces as:

```
plugin operation failed ... stage=read
ENOENT: no such file or directory, open '.../dist/tui.jsx'
```

`scripts/build-jsx.mjs` therefore (1) rewrites every relative import in the emitted
tree to an explicit `.js`, and (2) deletes leftover `.jsx` / `.jsx.map` artifacts.

## Architecture & Code Boundaries

- `src/index.ts`: Plugin entrypoint registering the `manage_todo_list` tool, prompt hooks, and bundled skills.
- `src/tui.tsx` & `src/tui/`: SolidJS TUI widget rendering the sidebar view, icons, and continue prompt generation.
- `src/todos/` (`todo-tree.ts`, `update.ts`, `display.ts`, `hint.ts`): Hierarchy logic, tree traversals, state mutations, and status formatting.
- `src/schemas/`: Zod schemas for validation:
  - Root IDs must be integers (`1`, `2`, ...).
  - Child IDs must be decimal numbers format `<root_id>.<1-9>` (e.g. `1.1`, `1.2`).
  - Exactly one root or child item can be `in_progress` across the entire list.
  - Progress moves forward only (`pending` -> `in_progress` -> `completed` / `cancelled`).
- `src/storage/`: Cross-process persistence in one SQLite file (`bun:sqlite` + Drizzle). Every session is partitioned by `session_key`, the raw OpenCode session id; `PRAGMA data_version` is the cross-process change signal. See "Storage & Concurrency" below.
- `skills/`: Bundled skills (`todolist`, `continue-todolist`) distributed with the plugin.

## Storage & Concurrency

Todos live in **one SQLite file** at `<home>/.opencode/sessions/todos.db`, opened
through `bun:sqlite` and Drizzle. `src/storage/db.ts` owns the connection.

### The two-process problem

The tool and the widget are loaded into **different OpenCode processes**:

```
entrypoint=.../todolist/index.js role=server   # manage_todo_list writes todos
entrypoint=.../todolist/tui.js  role=cli      # TUI widget reads todos
```

There is no shared memory between them, so an in-process event bus (what
OpenCode V1 uses) cannot work here. `src/storage/todo-store.ts` is the entire
hand-off surface.

### Required PRAGMAs

`openDatabase()` sets these **before** `migrate()`:

| PRAGMA | Why it is not optional |
| --- | --- |
| `journal_mode = WAL` | lets the reader work while the writer commits |
| `foreign_keys = ON` | SQLite default is OFF, and it is **per connection**; without it the composite parent/child constraint is silently ignored |
| `busy_timeout = 5000` | a concurrent writer waits instead of failing with `SQLITE_BUSY` |
| `synchronous = NORMAL` | durability/speed trade-off, matching OpenCode V1 |
| `cache_size = -64000` | 64 MB page cache |

### Why every write is one `IMMEDIATE` transaction

`mutateSessionTodos()` wraps read → transform → write in a single
`{ behavior: "immediate" }` transaction. Reading outside the transaction and
writing inside it allows a **lost update**: two processes each read revision N,
both write N+1, and one change disappears. `replaceSessionTodos()` covers the
whole-list case without a read.

### Change detection in the widget

`watchSessionTodos()` in `src/tui/todo-panel.tsx` combines two signals:

1. `fs.watch` on the database directory, debounced 50 ms. It watches the
   **directory**, not the file, because SQLite may replace the file on
   checkpoint and detach a file-level watcher.
2. A 1000 ms poll of `PRAGMA data_version` as a safety net. That counter
   changes when *another* connection commits and stays put for this
   connection's own writes — exactly the reader's signal.

### Legacy JSON import

`src/storage/migrate-json.ts` imports the old per-session
`todos-<timestamp>.json` files once. It is idempotent, refuses to merge into a
session that already has rows, and renames a source file to `.json.migrated`
**only after** the transaction commits. It never deletes data.

### Migrations

Schema lives in `src/storage/schema.ts`; SQL is generated by
`bunx drizzle-kit generate` into `drizzle/`, which **must ship with the
package** (`files` in `package.json`). `resolveMigrationsFolder()` locates it
relative to `import.meta.dirname`, which works because OpenCode loads local
plugins as ordinary files from disk. Never hand-edit a generated migration.

Drizzle 1.0 changed the folder layout, and the migrator enforces it — it
**throws** if it finds the old `meta/_journal.json`:

```
drizzle/<timestamp>_<name>/migration.sql    # the SQL the migrator reads
drizzle/<timestamp>_<name>/snapshot.json     # state for the next generate
```

An older checkout has flat `0000_*.sql` plus `meta/`. Convert it once with
`bunx drizzle-kit up` before the plugin can open the database.

`drizzle.config.ts` carries `dbCredentials.url` even though `generate` does not
need it: `migrate`, `studio`, and `check` refuse to run without it. The path
mirrors the store's resolution (`OPENCODE_TODOS_DIR` first, then
`~/.opencode/sessions`) so tooling inspects the real database.

### Clearing a list

`write` with an empty array removes every `todo_item` for the session but
**keeps the `todo_session` row** and bumps `revision`. That row owns `revision`
and `hint_revision`: dropping it would reset the change counter the widget polls
and could re-emit a hint that was already delivered.
