import assert from "node:assert/strict";
import { formatUpdateOutput, formatWriteOutput } from "../src/index";
import type { TodoRootItem } from "../src/schemas/todo";

// Output budget suite.
//
// The tool's `content` is fed back to the model on every call, so its size is a
// recurring cost rather than a one-off. These assertions pin the ceiling for
// each shape; raising one is a deliberate decision, not a side effect.
//
// Token counts are approximated the same way the design notes measured them
// (mixed Latin/identifier text averages ~3.6 chars per token). The limits below
// leave room for that approximation, so the test guards against regressions of
// tens of tokens, not single characters.

const estimate = (text: string) => Math.ceil(text.length / 3.6);

function assertBudget(label: string, text: string, ceiling: number) {
    const tokens = estimate(text);
    assert.ok(
        tokens <= ceiling,
        `${label}: ${tokens} tokens exceeds the ${ceiling} token ceiling (${text.length} chars)`,
    );
    // Cheap sanity check so a parser change cannot make the budget vacuous.
    assert.ok(text.length > 0, `${label}: output must not be empty`);
}

function measure(label: string, text: string, ceiling: number) {
    assertBudget(label, text, ceiling);
    console.log(
        `  ${label}: ${estimate(text)} tok / ${ceiling} max (${text.length} chars)`,
    );
}

// 1. Update that completes one root and starts the next. This is the hottest
//    path: it runs on every status transition.
{
    const before: TodoRootItem[] = [
        { id: 1, content: "First", status: "in_progress" },
        { id: 2, content: "Second", status: "pending" },
    ];
    const after: TodoRootItem[] = [
        { id: 1, content: "First", status: "completed" },
        { id: 2, content: "Second", status: "in_progress" },
    ];
    measure("update", formatUpdateOutput(after, before), 14);
}

// 2. Initializing a list. `Next:` is expected here because nothing has moved
//    yet, so the model needs a pointer.
{
    const init: TodoRootItem[] = [
        { id: 1, content: "Extract the useTodo hook", status: "in_progress" },
        { id: 2, content: "Split the render tree", status: "pending" },
        { id: 3, content: "Add unit tests", status: "pending" },
        { id: 4, content: "Update docs", status: "pending" },
    ];
    measure("write", formatWriteOutput(init, []), 22);
}

// 3. Everything finished.
{
    const done: TodoRootItem[] = [
        { id: 1, content: "Extract the useTodo hook", status: "completed" },
    ];
    measure(
        "all done",
        formatWriteOutput(done, [
            { id: 1, content: "Extract the useTodo hook", status: "in_progress" },
        ]),
        18,
    );
}

// 4. A long item title is the realistic worst case: the content is copied into
//    the output verbatim, so the ceiling has to account for it.
{
    const long =
        "Refactor the todo hint builder so it emits a compact state block and keeps notes only for the active item";
    const todos: TodoRootItem[] = [
        { id: 1, content: long, status: "in_progress" },
        { id: 2, content: long, status: "pending" },
    ];
    measure("long titles", formatWriteOutput(todos, []), 40);
}

// 5. A list with a stuck parent: children are done but the root is still open.
{
    const stuck: TodoRootItem[] = [
        {
            id: 1,
            content: "Parent",
            status: "in_progress",
            children: [{ id: 1.1, content: "Child", status: "completed" }],
        },
    ];
    measure(
        "stuck parent",
        formatWriteOutput(stuck, [
            {
                id: 1,
                content: "Parent",
                status: "in_progress",
                children: [{ id: 1.1, content: "Child", status: "in_progress" }],
            },
        ]),
        16,
    );
}

// 6. No transition at all: a no-op update must stay near-empty.
{
    const todos: TodoRootItem[] = [
        { id: 1, content: "First", status: "in_progress" },
        { id: 2, content: "Second", status: "pending" },
    ];
    measure("no transition", formatUpdateOutput(todos, todos), 12);
}

// 7. The phrases the terseness refactor removed must not come back. These are
//    instructions, not data, and each one repeats something already present in
//    the tool description or the hint rules.
{
    const before: TodoRootItem[] = [
        { id: 1, content: "First", status: "in_progress" },
        { id: 2, content: "Second", status: "pending" },
    ];
    const after: TodoRootItem[] = [
        { id: 1, content: "First", status: "completed" },
        { id: 2, content: "Second", status: "in_progress" },
    ];
    const every = [
        formatUpdateOutput(after, before),
        formatWriteOutput(after, before),
        formatWriteOutput(after, []),
    ].join("\n");

    for (const phrase of [
        "Continue immediately",
        "Print these lines to chat verbatim",
        "All todos finished",
        "Open items remain",
        "updated.",
    ]) {
        assert.ok(
            !every.includes(phrase),
            `removed phrase came back: ${JSON.stringify(phrase)}`,
        );
    }
    console.log("  removed phrases stay removed");
}

console.log("\n✔ Output budget suite passed");
