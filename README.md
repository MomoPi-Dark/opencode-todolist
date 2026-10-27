# OpenCode Todo List Plugin

Local OpenCode plugin for hierarchical todo tracking. It provides the
`manage_todo_list` tool and a real-time TUI widget above the composer.

## Features

- Hierarchical root tasks with optional subtasks.
- Numeric IDs: roots use `1`, `2`, …; children use `1.1`, `1.2`, …, with one
  digit after the dot (`1.1`–`1.9`). IDs may also arrive as numeric strings.
- Four operations: `read`, `create`, `update`, and `clear`.
- Atomic ordered update batches of up to 10 items.
- Forward-only status transitions and enforced root order.
- Scoped tree reads and compact completed-task summaries.
- Real-time TUI progress display with transition output and next-step hints.
- Bundled `todolist` and `continue-todolist` skills, registered automatically.

## Installation

Requires [Bun](https://bun.sh/) and OpenCode V2.

```bash
git clone https://github.com/MomoPi-Dark/opencode-todolist.git \
  ~/.config/opencode/plugins/todolist
cd ~/.config/opencode/plugins/todolist
bun install
```

`bun install` runs `prepare` and builds `dist/` from `src/`. The package also
ships prebuilt `dist/` files for installation through OpenCode:

```bash
opencode plugin add @gamflaz/opencode-todolist
```

For a local clone, install dependencies before use. The plugin entrypoints are
`index.js` for the server runtime and `tui.js` for the TUI runtime.

## Tool: `manage_todo_list`

### Operations

| Operation | Required fields | Purpose |
| --- | --- | --- |
| `read` | `operation` | Inspect the current list. |
| `create` | `operation`, `todos` | Create a new non-empty list. |
| `update` | `operation`, `updates` | Change existing rows. |
| `clear` | `operation`, `confirm: true` | Remove the completed/cancelled list. |

All operation objects are strict: unknown fields are rejected.

### IDs and item fields

| Field | Type | Description |
| --- | --- | --- |
| `id` | number or numeric string | Root: positive integer such as `1`; child: `1.1`–`1.9`. |
| `content` | string | Required one-line task description. |
| `status` | enum | `pending`, `in_progress`, `completed`, `cancelled`, or `error`. |
| `priority` | enum | Optional `high`, `medium`, or `low`. |
| `note` | string | Optional technical context or evidence. |
| `children` | array | Optional on roots; each child is a leaf and a root allows 1–9 children. |

Root IDs must be unique. Child IDs must belong to their root and must be
unique within that root. A child cannot contain another `children` array.

### Create

`create` accepts a non-empty `todos` array. It is rejected while any existing
todo is open (`pending`, `in_progress`, or `error`). Finish or cancel the old
list before creating a new one.

```json
{
  "operation": "create",
  "todos": [
    {
      "id": 1,
      "content": "Implement the feature",
      "status": "in_progress",
      "note": "Keep the API backwards compatible",
      "children": [
        { "id": 1.1, "content": "Write the handler", "status": "pending" },
        { "id": 1.2, "content": "Add tests", "status": "pending" }
      ]
    },
    { "id": 2, "content": "Update documentation", "status": "pending" }
  ]
}
```

### Read

`read` defaults to the complete list in `tree` format:

```json
{ "operation": "read" }
```

The supported scopes are:

| Scope | Target | Result |
| --- | --- | --- |
| `all` | omitted | Entire list. |
| `root` | root ID such as `1` | The root and all of its children. |
| `item` | root or child ID | One root row, or a child with its root as context. |

`target` is required for `root` and `item`, and is not allowed for `all`.
Unknown targets return an error instead of silently returning the whole list.

Use `format: "summary"` for a compact completed-task summary:

```json
{ "operation": "read", "format": "summary", "scope": "all" }
```

Typical tree output:

```text
[~] 1. Implement the feature (0/2)
    ↳ note: Keep the API backwards compatible
    [ ] 1.1 Write the handler
    [ ] 1.2 Add tests
[ ] 2. Update documentation
```

Markers are `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]`
cancelled, and `[!]` error. A scoped root retains its real completion count;
only the displayed rows are narrowed.

### Update

`updates` must be an array of 1–10 update objects, even when changing only one
todo. Arrays are applied in order inside one transaction. Each ID may appear
only once, and at most one update in a call may set `in_progress`.

Every update must change at least one of `status`, `content`, `priority`, or
`note`. Omit a field to keep it unchanged. Pass `null` for `priority` or
`note` to remove it.

```json
{
  "operation": "update",
  "updates": [
    {
      "id": 1.1,
      "status": "completed",
      "note": "Handler and tests verified"
    },
    {
      "id": 1.2,
      "status": "in_progress"
    }
  ]
}
```

The batch is atomic: if one update fails state validation, none of the updates
are applied. Each later update is validated against the state produced by the
previous update, so finishing one active item and then starting its sibling is
valid.

### Status and ordering rules

- `pending` may advance to `in_progress`, `completed`, `cancelled`, or `error`.
- `in_progress` may advance to `completed`, `cancelled`, or `error`.
- `error` may be repaired to `in_progress`, `completed`, or `cancelled`.
- `completed` and `cancelled` are final and locked.
- Roots are updated in order: finish or cancel the first open root before
  touching a later root. A root containing an error may be repaired early.
- Only one root and one child in that root may be `in_progress` at a time.

### Clear

`clear` is destructive and requires the literal boolean `true`:

```json
{ "operation": "clear", "confirm": true }
```

Clear is rejected while any todo is open (`pending`, `in_progress`, or
`error`). It succeeds on an already empty list and is idempotent.

## Tool responses

Successful writes return the updated `todos` and compact transition output such
as:

```text
Todos (1/2).
✓ 1/2: Write the handler
Next: 1.2 Add tests
```

Update refusals include a stable error code and the unchanged list. Read
responses include the selected list and rendered content; an unknown scoped
target returns `No todo <id>.`.

## Skills

The plugin bundles and automatically registers:

- `skills/todolist` — how to create and operate a todo list.
- `skills/continue-todolist` — how to resume an existing list after an interruption.

## Development

```bash
bun install      # installs dependencies and runs prepare
bun run check    # typecheck + tests
bun run compile  # tsc + Solid JSX transform + import rewriting
```

Run `bun run compile` after changing `src/`. The final build must contain the
compiled `.js` files and no stale `.jsx` runtime files; OpenCode's loader scans
the emitted imports and may otherwise resolve the wrong artifact.
