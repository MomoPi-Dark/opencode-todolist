CREATE TABLE `tag` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE `todo_item` (
	`session_key` text NOT NULL,
	`id` text NOT NULL,
	`parent_id` text,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`priority` text,
	`note` text,
	`position` integer NOT NULL,
	CONSTRAINT `todo_item_pk` PRIMARY KEY(`session_key`, `id`),
	CONSTRAINT `fk_todo_item_session_key_todo_session_session_key_fk` FOREIGN KEY (`session_key`) REFERENCES `todo_session`(`session_key`) ON DELETE CASCADE,
	CONSTRAINT `fk_todo_item_session_key_parent_id_todo_item_session_key_id_fk` FOREIGN KEY (`session_key`,`parent_id`) REFERENCES `todo_item`(`session_key`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `todo_item_dependency` (
	`session_key` text NOT NULL,
	`todo_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	CONSTRAINT `todo_item_dependency_pk` PRIMARY KEY(`session_key`, `todo_id`, `depends_on_id`),
	CONSTRAINT `fk_todo_item_dependency_session_key_todo_id_todo_item_session_key_id_fk` FOREIGN KEY (`session_key`,`todo_id`) REFERENCES `todo_item`(`session_key`,`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_todo_item_dependency_session_key_depends_on_id_todo_item_session_key_id_fk` FOREIGN KEY (`session_key`,`depends_on_id`) REFERENCES `todo_item`(`session_key`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `todo_item_tag` (
	`session_key` text NOT NULL,
	`todo_id` text NOT NULL,
	`tag_id` text NOT NULL,
	CONSTRAINT `todo_item_tag_pk` PRIMARY KEY(`session_key`, `todo_id`, `tag_id`),
	CONSTRAINT `fk_todo_item_tag_session_key_todo_id_todo_item_session_key_id_fk` FOREIGN KEY (`session_key`,`todo_id`) REFERENCES `todo_item`(`session_key`,`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_todo_item_tag_tag_id_tag_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `todo_session` (
	`session_key` text PRIMARY KEY,
	`revision` integer DEFAULT 0 NOT NULL,
	`hint_revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `todo_item_session_position_idx` ON `todo_item` (`session_key`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `todo_item_dependency_pair_idx` ON `todo_item_dependency` (`session_key`,`todo_id`,`depends_on_id`);--> statement-breakpoint
CREATE INDEX `todo_item_dependency_depends_on_idx` ON `todo_item_dependency` (`session_key`,`depends_on_id`);--> statement-breakpoint
CREATE INDEX `todo_item_tag_tag_idx` ON `todo_item_tag` (`tag_id`);