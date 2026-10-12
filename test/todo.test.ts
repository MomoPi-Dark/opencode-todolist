import assert from "node:assert/strict";
import {
  assertWriteIsInitialization,
  formatReadOutput,
  formatUpdateOutput,
} from "../src/index";
import {
  TodoInputToolSchema,
  TodoOutputToolSchema,
  type TodoRootItem,
  type TodoUpdateInput,
} from "../src/schema/todo.schema";
import { findNextTodo } from "../src/todo/hint";
import { TodoTree } from "../src/todo/todo";
import { updateTodoById } from "../src/todo/update";
import { buildContinuePrompt, CONTINUE_PROMPT_MAX_ITEMS } from "../src/tui";

// Test 1: Accepts valid single in_progress root task
{
  const todos: TodoRootItem[] = [
    { id: 1, content: "Task 1", status: "in_progress" },
    { id: 2, content: "Task 2", status: "pending" },
  ];
  const tree = new TodoTree(todos);
  const result = tree.validateAndNormalize();
  assert.equal(result.valid, true);
  console.log("✔ accepts valid single in_progress root task");
}

// Test 2: Rejects multiple in_progress root tasks
{
  const todos: TodoRootItem[] = [
    { id: 1, content: "Task 1", status: "in_progress" },
    { id: 2, content: "Task 2", status: "in_progress" },
  ];
  const tree = new TodoTree(todos);
  const result = tree.validateAndNormalize();
  assert.equal(result.valid, false);
  console.log("✔ rejects multiple in_progress root tasks");
}

// Test 3: Auto-completes parent when all subtasks completed
{
  const todos: TodoRootItem[] = [
    {
      id: 1,
      content: "Parent",
      status: "in_progress",
      children: [
        { id: 1.1, content: "Child 1", status: "completed" },
        { id: 1.2, content: "Child 2", status: "completed" },
      ],
    },
  ];
  const tree = new TodoTree(todos);
  const result = tree.validateAndNormalize();
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.data[0]?.status, "completed");
  }
  console.log("✔ auto-completes parent when all subtasks completed");
}

// Test 4: Rejects child ID mismatch with parent root ID
{
  const invalidChildInput = {
    operation: "write",
    todos: [
      {
        id: 1,
        content: "Parent 1",
        status: "in_progress",
        children: [
          {
            id: 2.1,
            content: "Child from other parent",
            status: "in_progress",
          },
        ],
      },
    ],
  };
  const parsed = TodoInputToolSchema.safeParse(invalidChildInput);
  assert.equal(parsed.success, false);
  console.log("✔ rejects child ID mismatch with parent root ID");
}

// Test 5: Rejects duplicate child IDs within same root
{
  const duplicateChildInput = {
    operation: "write",
    todos: [
      {
        id: 1,
        content: "Parent 1",
        status: "in_progress",
        children: [
          { id: 1.1, content: "Child A", status: "in_progress" },
          { id: 1.1, content: "Child B", status: "pending" },
        ],
      },
    ],
  };
  const parsed = TodoInputToolSchema.safeParse(duplicateChildInput);
  assert.equal(parsed.success, false);
  console.log("✔ rejects duplicate child IDs within same root");
}

// Test 6: Enforces at most 1 in_progress subtask per parent
{
  const todos: TodoRootItem[] = [
    {
      id: 1,
      content: "Parent",
      status: "in_progress",
      children: [
        { id: 1.1, content: "Child 1", status: "in_progress" },
        { id: 1.2, content: "Child 2", status: "in_progress" },
      ],
    },
  ];
  const tree = new TodoTree(todos);
  const result = tree.validateAndNormalize();
  assert.equal(result.valid, false);
  console.log("✔ enforces at most 1 in_progress subtask per parent");
}

// Test 7: Enforces parent to be in_progress if child is in_progress
{
  const todos: TodoRootItem[] = [
    {
      id: 1,
      content: "Parent",
      status: "pending",
      children: [{ id: 1.1, content: "Child 1", status: "in_progress" }],
    },
  ];
  const tree = new TodoTree(todos);
  const result = tree.validateAndNormalize();
  assert.equal(result.valid, false);
  console.log("✔ enforces parent to be in_progress if child is in_progress");
}

// Test 8: Renders tree view correctly with subtasks & notes
{
  const todos: TodoRootItem[] = [
    {
      id: 1,
      content: "Root task",
      status: "in_progress",
      children: [
        {
          id: 1.1,
          content: "Subtask 1",
          status: "completed",
          note: "done step",
        },
        { id: 1.2, content: "Subtask 2", status: "in_progress" },
      ],
    },
  ];
  const output = formatReadOutput(todos);
  assert.ok(output.includes("[~] 1. Root task (1/2)"));
  assert.ok(output.includes("[x] 1.1 ~~Subtask 1~~"));
  assert.ok(output.includes("↳ note: done step"));
  assert.ok(output.includes("[~] 1.2 Subtask 2"));
  console.log("✔ renders tree view correctly with subtasks & notes");
}

// Test 9: Validates write operation & output schema with nested children
{
  const input = {
    operation: "write",
    todos: [
      {
        id: 1,
        content: "Parent",
        status: "in_progress",
        children: [
          { id: 1.1, content: "Child", status: "in_progress", note: "work" },
        ],
      },
    ],
  };
  const parsedInput = TodoInputToolSchema.safeParse(input);
  assert.equal(parsedInput.success, true);

  const outputData = {
    todos: [
      {
        id: 1,
        content: "Parent",
        status: "in_progress" as const,
        children: [
          {
            id: 1.1,
            content: "Child",
            status: "in_progress" as const,
            note: "work",
          },
        ],
      },
    ],
  };
  const parsedOutput = TodoOutputToolSchema.safeParse(outputData);
  assert.equal(parsedOutput.success, true);
  console.log(
    "✔ validates write operation & output schema with nested children",
  );
}

// Test 10: Continue prompt includes progress and every open item
{
  const prompt = buildContinuePrompt({
    header: "Todos (1/4)",
    completed: 1,
    total: 4,
    items: [
      { id: 1, content: "Root", icon: "⦿", status: "in_progress", depth: 0 },
      {
        id: 1.1,
        content: "Child",
        icon: "○",
        status: "pending",
        depth: 1,
        note: "needs work",
      },
      { id: 2, content: "Done", icon: "✓", status: "completed", depth: 0 },
      { id: 3, content: "Cancelled", icon: "✗", status: "cancelled", depth: 0 },
    ],
  });
  assert.ok(prompt.includes("Progress: 1/4 completed."));
  assert.ok(prompt.includes("- 1 (currently being worked on) Root"));
  assert.ok(prompt.includes("  - 1.1 (not started) Child — needs work"));
  assert.ok(!prompt.includes("[in_progress]"));
  assert.ok(!prompt.includes("Done"));
  assert.ok(!prompt.includes("Cancelled"));
  console.log("✔ continue prompt includes progress and open items");
}

// Test 12: Continue prompt collapses extra items and truncates long text
{
  const longNote = "n".repeat(200);
  const many = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    content: "c".repeat(120),
    icon: "○",
    status: "pending" as const,
    depth: 0,
    note: longNote,
  }));
  const prompt = buildContinuePrompt({
    header: "Todos (0/6)",
    completed: 0,
    total: 6,
    items: many,
  });

  assert.ok(prompt.includes("... (3 more open item(s))"));
  assert.ok(
    prompt.split("\n").filter((line) => line.startsWith("- ")).length ===
    CONTINUE_PROMPT_MAX_ITEMS,
  );
  assert.ok(!prompt.includes(longNote));
  assert.ok(!prompt.includes("c".repeat(120)));
  assert.ok(prompt.includes("..."));
  console.log("✔ continue prompt collapses items and truncates long text");
}

// Test 11: Accepts 10 root todos with 5 numeric children per root
{
  const todos: TodoRootItem[] = Array.from({ length: 10 }, (_, rootIndex) => {
    const id = rootIndex + 1;
    return {
      id,
      content: `Root task ${id}`,
      status: "pending" as const,
      children: Array.from({ length: 5 }, (_, childIndex) => ({
        id: Number(`${id}.${childIndex + 1}`),
        content: `Child task ${id}.${childIndex + 1}`,
        status: "pending" as const,
      })),
    };
  });

  const parsed = TodoInputToolSchema.safeParse({ operation: "write", todos });
  assert.equal(parsed.success, true);

  const result = new TodoTree(todos).validateAndNormalize();
  assert.equal(result.valid, true);
  if (result.valid) {
    const stats = new TodoTree(result.data).calculateStats();
    assert.equal(result.data.length, 10);
    assert.equal(
      result.data.every((root) => root.children?.length === 5),
      true,
    );
    assert.equal(stats.totalSubTasks, 50);
    assert.equal(stats.completedSubTasks, 0);
  }

  const output = formatReadOutput(todos);
  assert.ok(output.includes("[ ] 1. Root task 1 (0/5)"));
  assert.ok(output.includes("[ ] 1.1 Child task 1.1"));
  assert.ok(output.includes("[ ] 10. Root task 10 (0/5)"));
  assert.ok(output.includes("[ ] 10.5 Child task 10.5"));
  console.log("✔ accepts 10 root todos with 5 numeric children per root");
}

// Test 12: Operation-specific input fields are enforced
{
  assert.equal(
    TodoInputToolSchema.safeParse({ operation: "write" }).success,
    false,
  );
  assert.equal(
    TodoInputToolSchema.safeParse({ operation: "read", todos: [] }).success,
    false,
  );
  assert.equal(
    TodoInputToolSchema.safeParse({
      operation: "update",
      id: 1.1,
      status: "completed",
    }).success,
    true,
  );
  assert.equal(
    TodoInputToolSchema.safeParse({ operation: "update", id: 1.1 }).success,
    false,
  );
  assert.equal(
    TodoInputToolSchema.safeParse({
      operation: "update",
      id: "1.1",
      status: "completed",
    }).success,
    false,
  );
  console.log("✔ enforces operation-specific input fields");
}

// Test 13: Updates one child without replacing the full tree
{
  const todos: TodoRootItem[] = [
    {
      id: 1,
      content: "Root",
      status: "in_progress",
      children: [{ id: 1.1, content: "Child", status: "pending" }],
    },
  ];
  const parsed = TodoInputToolSchema.safeParse({
    operation: "update",
    id: 1.1,
    status: "completed",
    note: "done",
  });
  assert.equal(parsed.success, true);
  if (parsed.success && parsed.data.operation === "update") {
    const result = updateTodoById(todos, parsed.data);
    assert.deepEqual(result.updated, {
      id: 1.1,
      scope: "child",
      content: "Child",
      status: "completed",
    });
    assert.equal(result.todos[0]?.children?.[0]?.note, "done");
    assert.equal(result.todos[0]?.content, "Root");
  }
  console.log("✔ updates one child while preserving the root tree");
}

// Test 14: Out-of-order updates are rejected until the previous root finishes
{
  const todos: TodoRootItem[] = [
    { id: 1, content: "Root 1", status: "in_progress" },
    { id: 4, content: "Root 4", status: "pending" },
  ];
  const updateRoot4: TodoUpdateInput = {
    operation: "update",
    id: 4,
    status: "in_progress",
  };
  assert.equal(TodoInputToolSchema.safeParse(updateRoot4).success, true);
  assert.throws(() => updateTodoById(todos, updateRoot4), /out of order/);

  const inOrder = updateTodoById(todos, {
    operation: "update",
    id: 1,
    status: "completed",
  });
  assert.equal(inOrder.todos[0]?.status, "completed");
  console.log(
    "✔ rejects out-of-order updates until the previous root finishes",
  );
}

// Test 14b: Progress never moves backward or edits a finished item
{
  const todos: TodoRootItem[] = [
    { id: 1, content: "Root 1", status: "in_progress" },
    { id: 2, content: "Root 2", status: "pending" },
  ];
  assert.throws(
    () =>
      updateTodoById(todos, {
        operation: "update",
        id: 1,
        status: "pending",
      }),
    /only moves forward/,
  );

  const withFinishedChild: TodoRootItem[] = [
    {
      id: 1,
      content: "Root 1",
      status: "in_progress",
      children: [{ id: 1.1, content: "Child 1.1", status: "completed" }],
    },
  ];
  assert.throws(
    () =>
      updateTodoById(withFinishedChild, {
        operation: "update",
        id: 1.1,
        status: "in_progress",
      }),
    /final/,
  );
  console.log("✔ keeps progress forward-only");
}

// Test 14c: An errored root may be fixed early, inside its own root only
{
  const todos: TodoRootItem[] = [
    { id: 1, content: "Root 1", status: "in_progress" },
    {
      id: 2,
      content: "Root 2",
      status: "error",
      children: [
        { id: 2.1, content: "Child 2.1", status: "pending" },
        { id: 2.2, content: "Child 2.2", status: "pending" },
      ],
    },
  ];

  assert.throws(
    () =>
      updateTodoById(todos, {
        operation: "update",
        id: 2.1,
        status: "in_progress",
      }),
    /still in_progress/,
  );

  const errFixAttempt: TodoUpdateInput = {
    operation: "update",
    id: 2,
    status: "in_progress",
  };
  assert.throws(
    () => updateTodoById(todos, errFixAttempt),
    /still in_progress/,
  );

  const idleError: TodoRootItem[] = [
    {
      id: 2,
      content: "Root 2",
      status: "error",
      children: [
        { id: 2.1, content: "Child 2.1", status: "completed" },
        { id: 2.2, content: "Child 2.2", status: "pending" },
      ],
    },
  ];
  const fixed = updateTodoById(idleError, errFixAttempt);
  assert.equal(fixed.todos[0]?.status, "in_progress");
  console.log("✔ allows fixing an error only inside its own root");
}

// Test 15: Full write is reserved for initialization
{
  assert.doesNotThrow(() => assertWriteIsInitialization([], []));
  assert.doesNotThrow(() =>
    assertWriteIsInitialization(
      [{ id: 1, content: "Existing", status: "pending" }],
      [],
    ),
  );
  assert.throws(
    () =>
      assertWriteIsInitialization(
        [{ id: 1, content: "Existing", status: "pending" }],
        [{ id: 2, content: "Replacement", status: "pending" }],
      ),
    /write is only allowed for initialization/,
  );
  assert.equal(
    TodoInputToolSchema.safeParse({ operation: "write", todos: [] }).success,
    true,
  );
  console.log("✔ reserves full write for initialization");
}

// Test 16: Update response reports progress, next step, and transitions
{
  const before: TodoRootItem[] = [
    { id: 1, content: "First", status: "in_progress" },
    { id: 2, content: "Second", status: "pending" },
  ];
  const after: TodoRootItem[] = [
    { id: 1, content: "First", status: "completed" },
    { id: 2, content: "Second", status: "in_progress" },
  ];
  const output = formatUpdateOutput(after, before);
  assert.ok(output.includes("Todos (1/2)"));
  assert.ok(output.includes('Next: 2 "Second"'));
  assert.ok(output.includes("✓"));
  assert.ok(output.includes("▶"));
  console.log("✔ update response reports progress and transitions");
}

// Test 17: Next-step selection follows strict root order
{
  const todos: TodoRootItem[] = [
    {
      id: 1,
      content: "Root 1",
      status: "in_progress",
      children: [
        { id: 1.1, content: "Child 1.1", status: "completed" },
        { id: 1.2, content: "Child 1.2", status: "pending" },
      ],
    },
    { id: 2, content: "Root 2", status: "pending" },
  ];
  assert.deepEqual(findNextTodo(todos), {
    id: 1.2,
    content: "Child 1.2",
    status: "pending",
  });

  const errored: TodoRootItem[] = [
    { id: 1, content: "Root 1", status: "pending" },
    {
      id: 2,
      content: "Root 2",
      status: "error",
      children: [{ id: 2.1, content: "Child 2.1", status: "pending" }],
    },
  ];
  assert.equal(findNextTodo(errored)?.id, 1);
  console.log("✔ next step respects strict root order");
}
