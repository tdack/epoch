CREATE TABLE `tree_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tree_user` ON `tree_memberships` (`tree_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_membership_user` ON `tree_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`access_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_access_sub_unique` ON `users` (`access_sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_access_sub` ON `users` (`access_sub`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `events` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `families` ADD `xref_id` text;--> statement-breakpoint
ALTER TABLE `families` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `families` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `families` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `individuals` ADD `xref_id` text;--> statement-breakpoint
ALTER TABLE `individuals` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `individuals` ADD `updated_at` integer;--> statement-breakpoint
CREATE INDEX `idx_ind_xref` ON `individuals` (`tree_id`,`xref_id`);--> statement-breakpoint
ALTER TABLE `trees` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_uq_fam_child` ON `family_children` (`family_id`,`child_id`);