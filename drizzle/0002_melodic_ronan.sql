CREATE TABLE `parent_child` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`parent_id` text NOT NULL,
	`child_id` text NOT NULL,
	`type` text DEFAULT 'unknown' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`union_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `individuals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_id`) REFERENCES `individuals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`union_id`) REFERENCES `unions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_parent_child_tree` ON `parent_child` (`tree_id`);--> statement-breakpoint
CREATE INDEX `idx_parent_child_parent` ON `parent_child` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_parent_child_child` ON `parent_child` (`child_id`);--> statement-breakpoint
CREATE INDEX `idx_parent_child_union` ON `parent_child` (`union_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_uq_parent_child_type` ON `parent_child` (`parent_id`,`child_id`,`type`);--> statement-breakpoint
CREATE TABLE `person_names` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`type` text DEFAULT 'birth' NOT NULL,
	`given_name` text,
	`surname` text,
	`name_prefix` text,
	`name_suffix` text,
	`is_preferred` integer DEFAULT false NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`person_id`) REFERENCES `individuals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_person_name_person` ON `person_names` (`person_id`);--> statement-breakpoint
CREATE TABLE `union_partners` (
	`id` text PRIMARY KEY NOT NULL,
	`union_id` text NOT NULL,
	`person_id` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`union_id`) REFERENCES `unions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `individuals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_union_partner_union` ON `union_partners` (`union_id`);--> statement-breakpoint
CREATE INDEX `idx_union_partner_person` ON `union_partners` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_uq_union_person` ON `union_partners` (`union_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `unions` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_union_tree` ON `unions` (`tree_id`);