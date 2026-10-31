CREATE TABLE `upload_session` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`purpose` text NOT NULL,
	`r2_key` text NOT NULL,
	`r2_upload_id` text NOT NULL,
	`part_size_bytes` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`parts_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text,
	`created_at` integer,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_upload_session_tree_created` ON `upload_session` (`tree_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_upload_session_status_expires` ON `upload_session` (`status`,`expires_at`);