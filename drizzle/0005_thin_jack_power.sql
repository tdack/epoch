CREATE TABLE `change_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`tree_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`changes_json` text NOT NULL,
	`inverse_json` text,
	`reverts_change_id` text,
	`correlation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_log_id_unique` ON `change_log` (`id`);--> statement-breakpoint
CREATE INDEX `idx_change_log_tree_seq` ON `change_log` (`tree_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_change_log_actor` ON `change_log` (`tree_id`,`actor_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_uq_change_log_reverts` ON `change_log` (`reverts_change_id`) WHERE "change_log"."reverts_change_id" is not null;--> statement-breakpoint
CREATE TABLE `change_log_records` (
	`change_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	PRIMARY KEY(`change_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`change_id`) REFERENCES `change_log`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_change_log_records_entity` ON `change_log_records` (`entity_id`);