CREATE TABLE `quality_dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`finding_key` text NOT NULL,
	`reason` text NOT NULL,
	`dismissed_by` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quality_dismissal_key` ON `quality_dismissals` (`tree_id`,`finding_key`);