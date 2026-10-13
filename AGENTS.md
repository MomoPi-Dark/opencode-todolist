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
- **Run all checks**: `bun run check` (runs typecheck then main test)
- **Compile build artifacts**: `bun run compile` (`tsc -p tsconfig.build.json && node scripts/build-jsx.mjs`)
- **Run core todo test**: `bun test/todo.test.ts`
- **Run skill parser tests**: `bun test/skill.test.ts`
- **Run skill content/schema test**: `bun test/skill.folder.test.ts`
- **Run full test suite**: `bun test/todo.test.ts && bun test/skill.test.ts && bun test/skill.folder.test.ts`

> **Note on test runner**: Do not use `bun test test/*.test.ts` as test files use Node's `node:assert` and custom runners rather than Bun's native BDD describe blocks. Execute test files directly with `bun <file>`.

## Build Artifacts & Git Distribution

This plugin is installed directly via Git URL (`opencode plugin add <git-url>`). OpenCode expects pre-compiled entrypoints immediately upon checkout:

- **Do NOT gitignore `dist/`, `index.js`, or `tui.js`**.
- `exports` mapping in `package.json`:
  - `.` -> `./dist/index.js`
  - `./tui` -> `./dist/tui.js`
- Root `index.js` and `tui.js` re-export from `./dist/` to support older loader resolutions.
- **Workflow after modifying `src/`**:
  1. `bun run check`
  2. `bun run compile`
  3. Ensure changes in `dist/`, `index.js`, and `tui.js` are staged together with `src/`.

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
