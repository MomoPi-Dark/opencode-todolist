# AGENTS.md

Context and operational rules for agents working on `opencode-sidebar-modern-todolist`.

## Project Overview

OpenCode plugin providing a hierarchical todo list engine (`manage_todo_list` tool), automatic skill registration, prompt injection hook, and real-time SolidJS terminal widget for the OpenTUI sidebar.

- **Runtime**: Bun (>= 1.3.0) + Node.js (>= 24/26)
- **Language**: TypeScript (`strict: true`)
- **Key dependencies**: `@opencode/plugin`, `@opentui/core`, `@opentui/solid`, `solid-js` (pinned to `1.9.12` to prevent peer conflicts), `zod`, `proper-lockfile`, `@resvg/resvg-js`.

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
- `src/storage/`: Cross-process persistence in `/tmp/opencode-todos/` with file locking (`proper-lockfile`).
- `skills/`: Bundled skills (`todolist`, `continue-todolist`) distributed with the plugin.
