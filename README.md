# OpenCode Todo List Plugin

A local OpenCode plugin for hierarchical todo tracking: a `manage_todo_list` tool
plus a TUI widget above the composer that shows progress in real time.

## Features

- Hierarchical tasks: any number of root tasks, each with up to 9 subtasks.
- Numeric IDs only: root `1`, `2`, … and subtasks `1.1`, `1.2`, … (`1.9` max).
- Small partial updates: change one item without resending the whole list.
- Scoped reads: pull the whole list, one branch, or a single item.
- Strict forward-only progress with enforced order between root tasks.
- Real-time TUI widget with collapse, scroll, `↻ Continue`, and clear controls.
- Bundled skills that teach the agent how to drive the tool.

## Installation

Requires [Bun](https://bun.sh/) and OpenCode V2.

```bash
git clone https://github.com/MomoPi-Dark/opencode-todolist.git \
  ~/.config/opencode/plugins/todolist
cd ~/.config/opencode/plugins/todolist
bun install
```

`bun install` runs the `prepare` script, which compiles `dist/` from `src/`
(TypeScript declarations plus Solid-compiled JSX). No extra step is required.

Or add it directly through the OpenCode CLI:

```bash
opencode plugin add @gamflaz/opencode-todolist
```

The npm package ships the prebuilt `dist/`, so no local build runs. OpenCode
loads local plugins from the plugins directory but does not install their
dependencies, so `bun install` is required before use.

## Tool: `manage_todo_list`

#### Operation fields

| Operation | Required fields             | Optional fields                |
| --------- | --------------------------- | ------------------------------ |
| `read`    | `operation`                 | `scope`, `target`              |
| `write`   | `operation`, `todos`        | None; use `todos: []` to clear |
| `update`  | `operation`, `id`, `status` | `content`, `priority`, `note`  |

For `update`, send `null` for `priority` or `note` to remove the existing value.

### Read

By default `read` returns the whole list. An optional `scope` narrows it to one
branch or one row, which keeps the response small on a long list.

| `scope`    | `target`            | Returns                                      |
| ---------- | ------------------- | -------------------------------------------- |
| `all`      | —                   | the whole list (default)                     |
| `root`     | a root id, e.g. `1` | that root and all of its subtasks            |
| `children` | a subtask id, `1.1` | that subtask, with its root shown as context |
| `item`     | `1` or `1.1`        | only that row                                |

`target` is only valid together with `scope: "root"`, `"children"`, or
`"item"` — passing it without one is rejected, so a scope can never be silently
ignored.

The whole list:

```json
{ "operation": "read" }
```

```text
[~] 1. Design architecture (1/2)
    ↳ note: Keep the hierarchy shallow
    [x] 1.1 Database schema
    [~] 1.2 API endpoints
[ ] 2. Write tests
```

One branch (`root`):

```json
{ "operation": "read", "scope": "root", "target": 1 }
```

A single subtask, with its root as context (`children`):

```json
{ "operation": "read", "scope": "children", "target": 1.2 }
```

```text
[~] 1. Design architecture (1/2)
    [~] 1.2 API endpoints
```

One row with no context (`item`):

```json
{ "operation": "read", "scope": "item", "target": 1.2 }
```

Markers: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` cancelled,
`[!]` error. Notes render under their item as `↳ note: …`.

Even when a scope hides rows, the root keeps its real `(completed/total)` count —
only the display is narrowed.

### Write

`write` initializes a session or clears it. A non-empty list is only accepted
while the session has no todos yet.

```json
{
  "operation": "write",
  "todos": [
    {
      "id": 1,
      "content": "Add auth endpoint",
      "status": "in_progress",
      "note": "Return 401 on bad token",
      "children": [
        { "id": 1.1, "content": "Write handler", "status": "pending" }
      ]
    },
    { "id": 2, "content": "Update docs", "status": "pending" }
  ]
}
```

Clear the current list:

```json
{ "operation": "write", "todos": [] }
```

### Fields

#### Todo item fields

| Field      | Type                        | Required      | Description                                                     |
| ---------- | --------------------------- | ------------- | --------------------------------------------------------------- |
| `id`       | number                      | Yes           | Root: positive integer. Child: `<root>.<n>`, such as `1.1`.     |
| `content`  | string                      | Yes           | Task summary.                                                   |
| `status`   | enum                        | Yes           | `pending`, `in_progress`, `completed`, `cancelled`, or `error`. |
| `priority` | `high` \| `medium` \| `low` | No            | Optional priority label.                                        |
| `note`     | string                      | No            | Technical context or evidence.                                  |
| `children` | array of child items        | No, root only | Up to 9 subtasks. Child items cannot contain more children.     |

Root IDs must be unique. A child ID must start with its parent root ID.

### Update

`update` changes one existing root or subtask. Send only the fields that change;
`status` is required.

```json
{
  "operation": "update",
  "id": 1.1,
  "status": "completed",
  "note": "Tests passing"
}
```

### Fields

| Field      | Required | Notes                                                        |
| ---------- | -------- | ------------------------------------------------------------ |
| `id`       | Yes      | Root number or subtask number (`1`, `1.1`).                  |
| `status`   | Yes      | `pending`, `in_progress`, `completed`, `cancelled`, `error`. |
| `content`  | No       | One-line summary shown in the widget.                        |
| `note`     | No       | Technical context or evidence. Pass `null` to remove.        |
| `priority` | No       | `high`, `medium`, or `low`. Pass `null` to remove.           |

## Skills

`skills/todolist` and `skills/continue-todolist` ship with the plugin and are
registered automatically. They explain how to use the tool and how to resume
tracked work.

## Development

```bash
bun install     # runs prepare -> compiles dist/
bun run check   # typecheck + tests
bun run compile # rebuild dist/ (tsc + Solid JSX transform)
```

`bun run compile` must be used instead of `bun run build`: the raw `tsc` pass
alone leaves intermediate `.jsx` files in `dist/`, which Bun then prefers over
the compiled `.js` and reports as `No renderer found` / `ENOENT ... dist/tui.jsx`.
