---
name: continue-todolist
description: Resumes an existing todo list created with manage_todo_list. Use when the user says continue/lanjutkan, returns to old work, resumes an interrupted task, or asks where you left off.
license: MIT
compatibility: opencode
metadata:
  opencode/autoinvoke: "true"
  audience: developers
  workflow: task-tracking
  tool: manage_todo_list
---

# Continue Todolist

The user wants to **resume work that is already tracked**. You do **not** need a
new plan: the stored list is the source of truth. Read it, find the current
step, and keep going.

## When to Use

- The user says "continue", "lanjutkan", "next", "keep going", "where were we?".
- You returned to a task after a break, a topic switch, or a new session.
- The TUI widget provides a `↻ Continue` button that populates the session prompt with a progress summary and remaining tasks labeled in natural language (e.g. `currently being worked on`, `not started`, `needs fixing`).
- A `<todo_state>` / `<todo_hint>` block told you that open todos exist.
- The user asks about progress, blockers, or what is left.

Create a **new** list instead (see the `todolist` skill) only when the user
gives a genuinely new goal. If the goal changed, update the existing list
rather than starting a parallel one.

## Procedure

1. **Read first — never guess.** Call `manage_todo_list` with
   `{ "operation": "read" }`. Never reconstruct the list from memory: another
   session, a `write`, or the user's `✕` button may have changed it.
2. **Empty list?** If `read` returns `No todos recorded.`, there is nothing to
   resume. Do not restore an old plan; create a new list only if the current
   request still qualifies (3+ steps or 2+ files).
3. **Pick the current step**, in this priority order:
   1. the `in_progress` leaf (the step that was running),
   2. a leaf in `error` (a step that failed and still needs a decision),
   3. the first `pending` leaf in order.
4. **Re-anchor the list if needed.** If nothing is `in_progress` but steps are
   still open, `write` the chosen step as `in_progress` first. Keep the single
   active chain rule: at most one item `in_progress`.
5. **State your position in one short line**, then continue immediately — do
   not ask "should I continue?". Example:
   `Resuming (2/4): 2.2 "API endpoints" — 1 done, 1 failed, 1 pending.`
6. **Work the step for real**, then `write` the update (`completed` with
   evidence in `note`, next item `in_progress`) and print the transition lines
   verbatim.
7. **Repeat** until every item is `completed` or `cancelled`.

## Handling the Statuses You May Find

- `completed` — already done; do not redo it, do not re-report it as completed.
- `cancelled` — intentionally skipped; leave it unless the user revives it.
- `error` — a failed step. Read its `note` (the reason), then either fix it
  (set `in_progress` → `completed`) or mark it `cancelled` if it no longer
  matters. Never silently treat it as done; it keeps the list open.
- `in_progress` — the resume point. Verify the work still applies before
  continuing, especially if the previous session ended mid-edit.

## Reconstructing Lost Context

- `read` gives you `content` and `note` for every step. The `note` field is
  where file paths, acceptance criteria and evidence were recorded — treat it
  as the handover document.
- If a step's `note` is empty and its intent is unclear, inspect the
  repository state (files, git status, tests) **before** marking anything.
- Any step already `completed` has an evidence trail in its `note`; trust it
  instead of re-verifying from scratch.

## Rules That Still Apply

- **One active chain.** At most one task/subtask `in_progress`; a subtask
  `in_progress` requires its parent `in_progress` too.
- **`write` initializes or clears.** Use a non-empty `write` only for a new
  session, use `write` with `todos: []` to clear, and use `update` for existing
  roots/children. `status` is required for `update`; other fields are patches.
- **Never reuse an old `id` for a new goal without an explicit `status`** — the
  stored status would be inherited.
- **Evidence in `note`** when completing; do not mark `completed` unverified.
- **Do not create a duplicate list.** Continuing means updating the existing
  one, not starting a second plan for the same goal.

## Anti-Patterns

- Guessing the list from memory instead of calling `read` first.
- Starting a new list when the user only asked to continue the existing one.
- Re-emitting `✓ Completed` lines for steps that were already completed.
- Leaving an `error` step unresolved while continuing past it.
- Asking permission to continue when todos are simply open.
- Ending the turn with open items and no blocker or question for the user.
