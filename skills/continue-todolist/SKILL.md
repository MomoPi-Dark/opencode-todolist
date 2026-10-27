---
name: continue-todolist
description: Resumes an existing todo list created with manage_todo_list. Use when the user says continue or lanjutkan, returns to old work, resumes an interruption, or asks what remains.
license: MIT
compatibility: opencode
metadata:
  opencode/autoinvoke: "true"
  audience: developers
  workflow: task-tracking
  tool: manage_todo_list
---

# Continue Todolist

Resume the stored list; do not reconstruct it from memory and do not create a
parallel list for the same goal.

## Procedure

1. Call:

   ```json
   { "operation": "read" }
   ```

2. If the result is empty, do not restore an old plan. Use `create` only when
   the current request is a new qualifying goal.
3. Choose the next leaf in this order:
   1. the current `in_progress` leaf;
   2. a leaf with `error` that needs fixing;
   3. the first `pending` leaf in list order.
4. If open work exists but nothing is `in_progress`, use `update` to start the
   chosen root. If it has children, start the parent before its child so the
   active-chain invariant remains valid.
5. State the resume position in one short line, then continue immediately.
6. Do the work for real. Use `update` to record `completed` with evidence in
   `note`, or `error` with the failure reason. Start the next item in the same
   call only when the update batch remains valid; `updates` accepts at most 10
   items and at most one item may become `in_progress` per call.
7. Repeat until every work item is `completed` or `cancelled`, or until a
   blocker requires user input.

## Read Scopes

Use the smallest read that answers the question:

```json
{ "operation": "read", "scope": "all", "format": "tree" }
{ "operation": "read", "scope": "root", "target": 1, "format": "tree" }
{ "operation": "read", "scope": "children", "target": 2.1, "format": "tree" }
{ "operation": "read", "scope": "item", "target": 1.1, "format": "summary" }
```

`all` reads the complete list, `root` reads one root and its children,
`children` reads a child with its root context, and `item` reads one root or
child row. `summary` shows completed rows only.

## Status Handling

- `completed` and `cancelled` are closed; do not redo them.
- `pending` is not started; start it with `update` when it is next.
- `in_progress` is the resume point.
- `error` needs a decision: fix it with `update`, or cancel it deliberately.
- Keep at most one active root and one active child under that root; an active
  child requires an active parent.
- Roots run in order. Do not complete, cancel, or start a later root while an
  earlier root is open.

## New Lists and Clearing

- `create` initializes or replaces a complete list only when the current list
  has no open work.
- `clear` is destructive: ask the user for explicit confirmation first, wait
  for a later affirmative reply, then send `{ "operation": "clear", "confirm": true }`.
  Never combine the confirmation question and the `clear` call in one response.
  It also requires no open root or child.
- `update` changes existing rows; it is the operation for continuing work.

Never use an operation or field not listed in the tool schema. Never mark work
complete without evidence in `note`, and never end while open work remains
unless blocked or waiting for the user.
