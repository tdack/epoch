CREATE TABLE `citations` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source_id` text,
	`source_ref` text,
	`description` text,
	`page` text,
	`quality` integer,
	`entry_date_raw` text,
	`entry_date_sort` text,
	`entry_date_sort_end` text,
	`entry_date_qualifier` text,
	`entry_date_precision` text,
	`entry_date_calendar` text,
	`text` text,
	`gedcom_extra` text,
	`gedcom_layout` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_citation_subject` ON `citations` (`subject_kind`,`subject_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_citation_source` ON `citations` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_citation_tree` ON `citations` (`tree_id`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`xref` text,
	`xref_aliases` text,
	`name` text,
	`address` text,
	`gedcom_extra` text,
	`gedcom_layout` text,
	`created_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_repository_xref` ON `repositories` (`tree_id`,`xref`);--> statement-breakpoint
CREATE INDEX `idx_repository_name` ON `repositories` (`tree_id`,"name" collate nocase);--> statement-breakpoint
CREATE TABLE `source_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`repository_id` text,
	`repository_ref` text,
	`call_number` text,
	`gedcom_extra` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_source_repository_source` ON `source_repositories` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_source_repository_repository` ON `source_repositories` (`repository_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`xref` text,
	`xref_aliases` text,
	`title` text,
	`author` text,
	`publication` text,
	`abbreviation` text,
	`text` text,
	`gedcom_extra` text,
	`gedcom_layout` text,
	`created_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_xref` ON `sources` (`tree_id`,`xref`);--> statement-breakpoint
CREATE INDEX `idx_source_title` ON `sources` (`tree_id`,"title" collate nocase,`id`);