CREATE TABLE `person_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tree_id` text NOT NULL,
	`person_id` text NOT NULL,
	`kind` text NOT NULL,
	`touched_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_uq_person_mark` ON `person_marks` (`user_id`,`tree_id`,`kind`,`person_id`);--> statement-breakpoint
CREATE INDEX `idx_person_mark_list` ON `person_marks` (`user_id`,`tree_id`,`kind`,`touched_at`);