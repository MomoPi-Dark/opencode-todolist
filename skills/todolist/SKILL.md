---
name: todolist
description: Tracks multi-step work via the manage_todo_list tool. Use when a request needs 3+ steps or touches 2+ files (feature, bugfix, refactor, migration, executing a plan). Skip for trivial single-change tasks.
license: MIT
compatibility: opencode
metadata:
  opencode/autoinvoke: "true"
  audience: developers
  workflow: task-tracking
  tool: manage_todo_list
  version: "1.3"
---

# Todolist Management

Plan and track multi-step work with `manage_todo_list`. The todo list is the single source of truth for progress. A TUI widget above the composer shows it in real time, so keep items short and readable.

## When to Use

Create a todo list (without asking permission) when the task has **3+ distinct steps** or **touches 2+ files**.

Skip it for trivial work: a rename, a one-line fix, a single edit plus a lint run, or a question that needs no changes.

## Rules

1. **Plan first.** Call `manage_todo_list` with `operation: "write"` before the first `write`/`edit`/`shell` call on a qualifying task.
2. **One active root, in order.** Roots run one at a time, top to bottom. Root `2` must not start while root `1` is still `pending`/`in_progress`/`error`; finish or cancel root `1` first. Inside one root, exactly one subtask may be `in_progress`, and its parent root is `in_progress` too. Progress never moves backward: `in_progress` never returns to `pending`, and a `completed`/`cancelled` item is locked.
3. **Error exception.** Only a root in `error` (or holding an errored child) may be worked on early, and only inside that root. Every other root still waits its turn. Fix it with a forward transition (`in_progress`, `completed`, or `cancelled`); `error` never becomes `pending`.
4. **Keep going (default).** While any item is `pending`, `in_progress` or `error`, continue with the next step without asking "should I continue?". Do not end your turn or write a final summary until every item is `completed`, `cancelled` or `error`-and-escalated. Stop only when you are blocked, need user input, or the user clearly changes topic or tells you to stop or pause.
5. **Real work between transitions.** Never move several items from `pending` to `completed` in one update without actual execution in between.
6. **Evidence in `note`.** When completing an item, record what was touched or verified (e.g. `created: src/auth.ts`, `tests passing`). Do not mark `completed` until verified.
7. **Short `content`, detailed `note`.** `content` stays one line (hard limit 80 chars) for the compact TUI widget. File paths, acceptance criteria, and verification steps go in `note` (hard limit 200 chars). Notes render under the item as `↳ note: ...`.
8. **Granularity.** One step = one verifiable outcome. Hard limits: at most 9 children per root task, with child IDs strictly `<root_id>.<n>` where `n` is from 1 to 9 (numeric e.g. `1.1` to `1.9`). Subtasks are one level deep (children cannot have their own children).
9. **Priority is optional.** Set `priority` (`high` | `medium` | `low`) only when it helps, e.g. `high` for a blocking or critical-path step. Omit it otherwise.

## Status Rules

| Situation                                                                  | Result                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------- |
| All children `completed`                                                   | Parent becomes `completed` automatically           |
| Child `in_progress`, parent `pending`                                      | Parent must be `in_progress` (hierarchy invariant) |
| Parent `completed` or `cancelled` while a child is `pending`/`in_progress` | Invalid: finish or cancel the children first       |
| Parent `completed` while a child is `error`                                | Invalid: resolve the errored child first           |
| Two `in_progress` items outside one parent/child chain                     | Invalid: only one active chain                     |
| Remaining children are only `completed` + `cancelled`                      | Set the parent to `completed` yourself             |
| A step failed                                                              | Set it to `error` (kept open) with the reason in `note` |

If a non-empty `write` is rejected because the session already has todos, use
`update` for the target item instead. Use `write` with `todos: []` only to clear.

## Tool Interface

`manage_todo_list` supports three operations. A non-empty `write` initializes a
session, `write` with `todos: []` clears it, and `update` changes one existing
root or child without resending the full list.

### Item fields

| Field      | Required    | Notes                                                                                                                                                                                                                                            |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`       | Required | Task identifier (`number`, e.g. `1`, `2`). Subtasks use format `<root_id>.<n>` (`number`, e.g. `1.1`, `1.2`).                                                                                                   |
| `content`  | Required | Summary shown in the TUI. Hard limit 80 chars.                                                                                                   |
| `status`   | Required | `pending` \| `in_progress` \| `completed` \| `cancelled` \| `error`. Exactly one task/subtask may be `in_progress`.                                  |
| `note`     | Optional    | Technical context or evidence.                                                                                                                                                                                                                   |
| `priority` | Optional    | `high` \| `medium` \| `low`.                                                                                                                                                                                                                     |
| `children` | Optional    | Subtasks with the same fields (except `children`).                                                                                                                                                                                               |

### Read

```json
{ "operation": "read" }
```

Returns the current todos as a progress tree:

```
[x] 1. Design architecture
[~] 2. Implement backend (1/2)
    ↳ note: Ensure strict input validation
    [x] 2.1 Database schema
    [~] 2.2 API endpoints
        ↳ note: Return 401 when unauthenticated
[ ] 3. Write tests
```

Markers: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` cancelled, `[!]` error.

### Update one item

Use a numeric root ID (`1`) or child ID (`1.1`) and send only changed fields.
`status` is required:

```json
{
  "operation": "update",
  "id": 1.1,
  "status": "completed",
  "note": "tests passing"
}
```

Order rules enforced by the tool:

1. Only the first unfinished root may change. Root `2` is rejected while root `1` is still open.
2. Inside that root, work one subtask at a time; starting a second `in_progress` subtask is rejected.
3. Progress only moves forward. `in_progress` cannot return to `pending`, and `completed`/`cancelled` items are locked (`error` may still be fixed).
4. A root in `error` may be fixed early, but only that root and its own children.
5. Starting a new `in_progress` while another root is `in_progress` is rejected: finish or cancel the running root first.

If a `write` is rejected, or an `update` is refused, read the error and fix the
list order instead of forcing the change.

### Error status

Use `error` when a step **failed** and needs a decision. It is an *open*
status: the list stays active, `error` is never counted as progress, and the
step is reported to the user as the next thing to resolve. Put the reason in
`note` — the TUI shows it when the row is clicked and it is appended to the
`✗  Error (n/t): <task> — <reason>` transition line. Then either fix it (back
to `in_progress`/`completed`) or mark it `cancelled` if it is no longer needed.
A parent cannot be `completed` while any child is `error`.

### Write (initialization)

Non-empty `write` is allowed only when the session has no todos yet. It cannot
replace an existing list; use `update` for existing items.

```json
{
  "operation": "write",
  "todos": [
    {
      "id": 1,
      "content": "Add auth endpoint",
      "status": "in_progress",
      "priority": "high",
      "note": "src/auth.ts, must return 401 on bad token",
      "children": [
        {
          "id": 1.1,
          "content": "Write handler",
          "status": "completed",
          "note": "created: src/auth.ts"
        },
        { "id": 1.2, "content": "Add validation", "status": "in_progress" }
      ]
    },
    { "id": 2, "content": "Update docs", "status": "pending" }
  ]
}
```

### Clear

Pass an empty list to clear the current list:

```json
{ "operation": "write", "todos": [] }
```

Never reuse old ids for a new goal without an explicit `status`: an omitted status is inherited from the old item with that id, so a new item could start as `completed`.

Use `read` first when unsure of the current state. For existing items, use
`update` with the target `id` and required `status`; `content`, `note`, and
`priority` are optional patches.

## Workflow

1. Receive a qualifying request.
2. `write` the plan: first item `in_progress`, the rest `pending`.
3. Execute the active step.
4. `write` the update: mark it `completed` with evidence in `note` (or `error` with the reason in `note` when it failed), set the next item `in_progress`.
5. Repeat until all items are `completed` or `cancelled`.

After a `write`, the tool returns a short status such as `Todos (2/4) updated. Next: 2.2 "API endpoints". Continue immediately.` (or `All todos finished.` when nothing is open). If the result also contains transition lines (e.g. `✓  Completed (2/3): <task>`, `▶  Starting (3/3): <task>`, `✗  Error (3/3): <task> — <reason>`) or a `Next: <id> "<content>"` hint, print the transition lines to chat **verbatim** and continue with the named step immediately. If the result has none, do not invent them. Add no other per-step commentary. Post a short chat message at the start (the plan) and at the end (a summary), or when a step is blocked or cancelled.

## Context Recovery

The TUI widget provides a `↻ Continue` button that dispatches a detailed resumption prompt to the active session when work remains open and the session is idle. The generated prompt presents open tasks with natural language status descriptions (`currently being worked on`, `not started`, `needs fixing`) rather than raw internal enums, and details current progress alongside any task notes.

**Main form (`<todo_state>` + `<todo_rules>`)**, injected on every request while any item is open:

```
<todo_state>
Progress 2/5 completed.
Now: 2.2 API endpoints (Return 401 when unauthenticated)
Next: 3 Write tests; 4 Update docs
</todo_state>
<todo_rules>Open todos remain. Continue the in_progress item now. ...</todo_rules>
```

- `Progress` counts **leaves**: a child when a parent has children, otherwise the parent itself.
- `Now` is the `in_progress` leaf with its `note`. If no step is running but one is `error`, `Now` names it and its reason. `Next` lists up to 3 upcoming `pending` leaves.
- If `Now` says nothing is `in_progress`, `write` the first `pending` item as `in_progress` and continue.

**Fallback form (`<todo_hint>`)**, used only when the host has no `context` hook. It is injected once per list change and says: _"Active todos exist. If continuing previous work, call manage_todo_list [read] first. Ignore if the user is discussing something else."_

How to act on either:

- **Default: continue.** Treat open todos as work you must keep executing, without waiting for the user to say "continue". `read` for the full list when `<todo_state>` is not enough, or when you only got `<todo_hint>`.
- Resume from the `in_progress` item, then a failed (`error`) one, then the first `pending` one. If the user provides a new goal, new multi-step request, or indicates creating/starting a new task list, immediately replace and initialize the new todo list via `manage_todo_list [write]`.
- Ignore the hint only if the user clearly moved to an unrelated topic, or asked to stop or pause. Do not drop the list: leave it as is and answer the user.
- Expiry: the main form stops after about 6 hours without a `write`, the fallback after about 30 minutes. Nothing is injected when all items are `completed` or `cancelled`. If you resume old work with no hint, `read` anyway.
- If `read` returns an empty list, the user may have cleared it with the `✕` button in the widget. Do not restore the old plan; create a new list only if the current request still qualifies.

## Anti-Patterns

- Editing files on a qualifying task without an initialized todo list.
- Starting root 2 while root 1 is still open, or changing anything outside the current root (except fixing an errored root).
- Moving progress backward: `in_progress` back to `pending`, or reopening a `completed`/`cancelled` item.
- Marking items `completed` without execution or evidence.
- Treating a failed (`error`) step as done instead of fixing or cancelling it, or leaving it without a reason in `note`.
- Ending the turn with open items and no blocker, or pausing to ask permission to continue.
- Ignoring `<todo_state>` / `<todo_rules>` while items are still open.
- Having more than one `in_progress` root, or more than one `in_progress` subtask in a root.
- Using `write` to modify an existing list instead of using `update`.
- Reusing old ids for a new goal without setting `status`.
- Putting long paths or acceptance criteria in `content` instead of `note`.
- Inventing or renumbering transition lines the tool did not return.
- Creating a todo list for trivial single-change tasks.
