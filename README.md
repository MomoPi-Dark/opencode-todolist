# OpenCode Todo List Plugin

A local OpenCode plugin for hierarchical todo tracking: a `manage_todo_list` tool
plus a TUI widget above the composer that shows progress in real time.

## Features

- Hierarchical tasks: any number of root tasks, each with up to 9 subtasks.
- Numeric IDs only: root `1`, `2`, … and subtasks `1.1`, `1.2`, … (`1.9` max).
- Small partial updates: change one item without resending the whole list.
- Strict forward-only progress with enforced order between root tasks.
- Real-time TUI widget with collapse, scroll, `↻ Continue`, and clear controls.
- Bundled skills that teach the agent how to drive the tool.

## Installation

Requires [Bun](https://bun.sh/) and OpenCode V2.

```bash
git clone https://github.com/<your-account>/opencode-todolist.git \
  ~/.config/opencode/plugins/todolist
cd ~/.config/opencode/plugins/todolist
bun install
bun run build
```

OpenCode loads local plugins from the plugins directory, but it does not install
their dependencies, so `bun install` is required before use.

## Tool: `manage_todo_list`

### Read

```json
{ "operation": "read" }
```

Returns the current list as a progress tree:

```text
[~] 1. Design architecture (1/2)
    ↳ note: Keep the hierarchy shallow
    [x] 1.1 Database schema
    [~] 1.2 API endpoints
[ ] 2. Write tests
```

Markers: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` cancelled,
`[!]` error. Notes render under their item as `↳ note: …`.

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

Field values:

| Field      | Required | Notes                                                        |
| ---------- | -------- | ------------------------------------------------------------ |
| `id`       | Yes      | Root number or subtask number (`1`, `1.1`).                   |
| `status`   | Yes      | `pending`, `in_progress`, `completed`, `cancelled`, `error`.  |
| `content`  | No       | One-line summary shown in the widget.                         |
| `note`     | No       | Technical context or evidence. Pass `null` to remove.         |
| `priority` | No       | `high`, `medium`, or `low`. Pass `null` to remove.            |

## Rules

1. **One root at a time, in order.** Root `2` cannot start while root `1` is
   still open. Finish or cancel root `1` first.
2. **One active subtask per root.** Starting a second `in_progress` subtask is
   rejected until the first one finishes or is cancelled.
3. **Forward-only progress.** `in_progress` never returns to `pending`, and
   `completed` or `cancelled` items are locked.
4. **Error exception.** A root that reports `error` may be fixed early, but only
   that root and its own subtasks; every other root still waits its turn.
5. **Evidence in `note`.** Record what was verified before marking an item
   `completed`.

Every response reports progress, the next step, and any status transitions, for
example:

```text
Todos (2/4) updated. Next: 2 "Write tests". Continue immediately.
```

## TUI widget

The widget sits above the session composer:

- Collapsed view shows the progress count and the active item.
- Expand it to see every task; long lists scroll.
- `↻ Continue` asks the session to resume the next open item with a short
  summary of what remains.
- `✕` clears the list.

## Skills

`skills/todolist` and `skills/continue-todolist` ship with the plugin and are
registered automatically. They explain how to use the tool and how to resume
tracked work.

## Development

```bash
bun install
bun run check   # typecheck + tests
bun run build   # compile the plugin entrypoints
```

## Publishing notes

Do not commit environment files, local dependencies, or generated build output.
