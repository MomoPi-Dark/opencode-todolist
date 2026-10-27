---
name: todolist
description: Tracks multi-step work with the manage_todo_list tool. Use when a request has 3+ steps or touches 2+ files; skip trivial single-change questions.
license: MIT
compatibility: opencode
metadata:
  opencode/autoinvoke: "true"
  audience: developers
  workflow: task-tracking
  tool: manage_todo_list
  version: "1.4"
---

# Todolist Management

Use `manage_todo_list` as the source of truth for multi-step work. Follow the
tool contract below exactly; do not invent operation names or fields.

## When to Use

Use it when work has **3+ distinct steps** or touches **2+ files**. Skip it for
a trivial rename, one-line fix, single edit plus a check, or a question that
needs no change.

## Contract

The valid `operation` values are `create`, `read`, `update`, and `clear`.

### `create`

Create or replace a complete list with at least one root:

```json
{
  "operation": "create",
  "todos": [
    {
      "id": 1,
      "content": "Implement the feature",
      "status": "in_progress",
      "children": [
        { "id": 1.1, "content": "Write the handler", "status": "pending" }
      ]
    },
    { "id": 2, "content": "Verify the feature", "status": "pending" }
  ]
}
```

Each root has `id`, `content`, and `status`; it may also have `priority`,
`note`, and `children`. A child has the same fields except `children`.

- There may be at most **50 roots** and **9 children per root**.
- Root ids are positive integers (`1`, `2`, ...).
- Child ids use `<root_id>.<n>` with `n` from `1` to `9` (`1.1`, `1.2`, ...).
- `content` is a trimmed string of 1–500 characters.
- `note` is an optional string of at most 1000 characters.
- `priority`, when present, is `high`, `medium`, or `low`.
- `status` is `pending`, `in_progress`, `completed`, `cancelled`, or `error`.

`create` is rejected while the current list contains any `pending`,
`in_progress`, or `error` todo. Finish or cancel the current list before
creating a replacement.

### `read`

Read defaults to the complete tree in `tree` format:

```json
{ "operation": "read" }
```

Supported formats are `tree` and `summary`. `summary` lists completed rows
only; when none are completed it returns `No completed tasks yet.`.

Supported scopes:

```json
{ "operation": "read", "scope": "all", "format": "tree" }
{ "operation": "read", "scope": "root", "target": 1, "format": "tree" }
{ "operation": "read", "scope": "children", "target": 2.1, "format": "tree" }
{ "operation": "read", "scope": "item", "target": 1.1, "format": "summary" }
```

- `all` returns the whole list and has no `target`.
- `root` requires a root id and returns that root with all its children.
- `children` requires a child id and returns that child with its root shown above it.
- `item` requires a root or child id and returns only that targeted row.
- An unknown target is an error; it does not silently return the full list.

### `update`

Update an array of **1–10** updates, even when changing one item. The array is applied in order
and each id may appear only once:

```json
{
  "operation": "update",
  "updates": [
    { "id": 1.1, "status": "completed", "note": "tests passing" },
    { "id": 1.2, "status": "in_progress" }
  ]
}
```

Every update must change at least one of `status`, `content`, `priority`, or
`note`. `status` itself is optional when another field is being patched.
`priority: null` and `note: null` remove those fields. `cancel_remaining: true`
requires `status: "cancelled"` and cancels remaining pending children under
the target root.

Only one update in a call may set `status: "in_progress"`. Use array order to
finish one item and then start the next; send a follow-up call when another
`in_progress` status is needed. A failed batch is not partially applied.

The list validator also requires:

- no more than one top-level root is `in_progress`;
- no more than one child under a root is `in_progress`;
- an `in_progress` child has an `in_progress` parent;
- roots are handled in order; a later root cannot be completed, cancelled, or
  started while an earlier root is still open.

### `clear`

`clear` is destructive. Ask the user for confirmation before calling it. Do
not send the `clear` tool call in the same response that asks for confirmation;
wait for a later user reply that explicitly agrees. After confirmation, send:

```json
{ "operation": "clear", "confirm": true }
```

The operation is rejected while any root or child is open. `confirm: true` is
the tool-level confirmation, not a substitute for the user's explicit reply.

## Working Rules

1. Read first when the current list is unknown or may have changed.
2. If there is no existing list and the work qualifies, initialize it with
   `create`; do not use an unsupported operation.
3. Keep one active root/child chain. A child may be active only under its
   active parent.
4. Do real work between status changes. Mark a step `completed` only after
   verification and record evidence in `note`.
5. If a step fails, use `status: "error"` with the reason in `note`; resolve
   or cancel it before declaring the list finished.
6. Continue through open items without asking permission. Stop only when
   blocked, waiting for user input, or the user clearly changes topic.
7. When an operation is refused, read the error and current list, then make a
   valid `update` instead of forcing an unsupported transition.

Keep `content` short enough for the TUI. Put paths, acceptance criteria, and
verification evidence in `note`.
