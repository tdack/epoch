CREATE TABLE `import_job` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`r2_object_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`error` text,
	`created_by` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_import_job_tree_created` ON `import_job` (`tree_id`,`created_at`);