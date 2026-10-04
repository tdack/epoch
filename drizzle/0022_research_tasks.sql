CREATE TABLE `research_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_id` text,
	`due_date` text,
	`subject_kind` text,
	`subject_id` text,
	`finding_key` text,
	`link_cleared_kind` text,
	`created_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_status` ON `research_tasks` (`tree_id`,`status`,`due_date`,`id`);--> statement-breakpoint
CREATE INDEX `idx_task_subject` ON `research_tasks` (`subject_kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_task_assignee` ON `research_tasks` (`tree_id`,`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_task_finding` ON `research_tasks` (`tree_id`,`finding_key`);