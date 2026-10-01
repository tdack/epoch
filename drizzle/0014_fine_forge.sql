CREATE TABLE `tree_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_invitation_tree_email` ON `tree_invitations` (`tree_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_invitation_email` ON `tree_invitations` (`email`);--> statement-breakpoint
ALTER TABLE `tree_memberships` ADD `version` integer DEFAULT 1 NOT NULL;