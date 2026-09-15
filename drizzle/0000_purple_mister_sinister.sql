CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`type` text NOT NULL,
	`date_raw` text,
	`date_sort` text,
	`place` text,
	`description` text,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_event_entity` ON `events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_event_tree` ON `events` (`tree_id`);--> statement-breakpoint
CREATE TABLE `families` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`husband_id` text,
	`wife_id` text,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`husband_id`) REFERENCES `individuals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`wife_id`) REFERENCES `individuals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_fam_tree` ON `families` (`tree_id`);--> statement-breakpoint
CREATE INDEX `idx_fam_husband` ON `families` (`husband_id`);--> statement-breakpoint
CREATE INDEX `idx_fam_wife` ON `families` (`wife_id`);--> statement-breakpoint
CREATE TABLE `family_children` (
	`family_id` text NOT NULL,
	`child_id` text NOT NULL,
	`pedigree` text DEFAULT 'birth',
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_id`) REFERENCES `individuals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_fam_child` ON `family_children` (`family_id`,`child_id`);--> statement-breakpoint
CREATE INDEX `idx_child` ON `family_children` (`child_id`);--> statement-breakpoint
CREATE TABLE `individuals` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`given_name` text,
	`surname` text,
	`sex` text DEFAULT 'U',
	`created_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ind_tree` ON `individuals` (`tree_id`);--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`r2_object_key` text NOT NULL,
	`cf_image_id` text,
	`title` text,
	`mime_type` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_entity` ON `media_items` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_media_tree` ON `media_items` (`tree_id`);--> statement-breakpoint
CREATE TABLE `trees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer,
	`updated_at` integer
);
