import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import type { Priority, TodoStatus } from "../schemas/status";

/**
 * Relational storage for todos.
 *
 * Layout: one database file holds every session. Rows are partitioned by
 * `session_key`, the OpenCode session id, so a session's data never leaks into
 * another session's queries while still sharing one connection. Rows written by
 * an older build keyed by a SHA-256 digest of that id are still found through
 * `TodoStore.legacyKey`, which recomputes the same digest.
 *
 * Why a database instead of the previous per-session JSON files:
 * - foreign keys make parent/child integrity structural instead of validated
 *   after the fact
 * - transactions make a multi-row write atomic, so a reader can never observe
 *   a half-written list
 * - `PRAGMA data_version` gives cross-process change detection, which is what
 *   the TUI needs (the tool and the widget run in separate processes)
 *
 * `id` is TEXT, not INTEGER: child ids are dotted values such as `1.1`, and
 * storing them as numbers would lose the shape. `position` carries ordering;
 * ids are stable identifiers only.
 */

/** One row per OpenCode session that has ever stored a todo list. */
export const todoSession = sqliteTable("todo_session", {
  sessionKey: text("session_key").primaryKey(),
  /** Bumped on every write; readers poll `PRAGMA data_version` to detect it. */
  revision: integer("revision").notNull().default(0),
  /** Revision at which the resume hint was last injected, so it fires once. */
  hintRevision: integer("hint_revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** One row per todo item: a root when `parent_id` is NULL, otherwise a child. */
export const todoItem = sqliteTable(
  "todo_item",
  {
    sessionKey: text("session_key")
      .notNull()
      .references(() => todoSession.sessionKey, { onDelete: "cascade" }),
    id: text("id").notNull(),
    /** NULL for a root; the parent's `id` for a subtask. */
    parentId: text("parent_id"),
    content: text("content").notNull(),
    status: text("status").$type<TodoStatus>().notNull(),
    priority: text("priority").$type<Priority>(),
    note: text("note"),
    /** Render order within the session. */
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionKey, t.id] }),
    // Composite self-reference: the parent must live in the same session, so a
    // child can never point at another session's item.
    foreignKey({
      columns: [t.sessionKey, t.parentId],
      foreignColumns: [t.sessionKey, t.id],
    }).onDelete("cascade"),
    index("todo_item_session_position_idx").on(t.sessionKey, t.position),
  ],
);

/** Free-form labels. Present so tagging does not need a later migration. */
export const tag = sqliteTable("tag", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

/** Many-to-many between items and labels. */
export const todoItemTag = sqliteTable(
  "todo_item_tag",
  {
    sessionKey: text("session_key").notNull(),
    todoId: text("todo_id").notNull(),
    tagId: text("tag_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionKey, t.todoId, t.tagId] }),
    foreignKey({
      columns: [t.sessionKey, t.todoId],
      foreignColumns: [todoItem.sessionKey, todoItem.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tagId],
      foreignColumns: [tag.id],
    }).onDelete("cascade"),
    index("todo_item_tag_tag_idx").on(t.tagId),
  ],
);

/**
 * Ordering constraints between items in the same session.
 *
 * Not enforced by the tool yet; the table exists so the storage layer does not
 * need a schema change when dependency support lands.
 */
export const todoItemDependency = sqliteTable(
  "todo_item_dependency",
  {
    sessionKey: text("session_key").notNull(),
    todoId: text("todo_id").notNull(),
    dependsOnId: text("depends_on_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionKey, t.todoId, t.dependsOnId] }),
    foreignKey({
      columns: [t.sessionKey, t.todoId],
      foreignColumns: [todoItem.sessionKey, todoItem.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.sessionKey, t.dependsOnId],
      foreignColumns: [todoItem.sessionKey, todoItem.id],
    }).onDelete("cascade"),
    uniqueIndex("todo_item_dependency_pair_idx").on(
      t.sessionKey,
      t.todoId,
      t.dependsOnId,
    ),
    index("todo_item_dependency_depends_on_idx").on(
      t.sessionKey,
      t.dependsOnId,
    ),
  ],
);

export const schema = {
  todoSession,
  todoItem,
  tag,
  todoItemTag,
  todoItemDependency,
};
