CREATE TABLE `gedcom_preserved` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`owner_xref` text,
	`lines` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_preserved_tree` ON `gedcom_preserved` (`tree_id`);--> statement-breakpoint
CREATE INDEX `idx_preserved_owner` ON `gedcom_preserved` (`tree_id`,`owner_xref`);