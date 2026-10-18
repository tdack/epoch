CREATE TABLE `subtree` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`root_person_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_subtree_slug` ON `subtree` (`tree_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_subtree_root` ON `subtree` (`tree_id`,`root_person_id`);