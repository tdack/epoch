-- ADR-082 step 1 (expand). Adds tables and columns only; nothing here rebuilds a table, so every
-- existing media_links and media_items row survives untouched. Every new column on an existing table
-- is nullable with no default: a change image written before this migration has no key for it, and
-- ADR-051's null-fill would then refuse the undo of any non-null live value. Null means the default
-- (sort_order 0, status 'resolved'). Hand edits to the drizzle-kit output, each marked where it
-- occurs: (a) the expression index is written as coalesce(fact_id, '') (drizzle-kit quoted the column
-- inside the expression, which is not valid SQL); (b) the new unique index is created before the old
-- one is dropped, as ADR-082 orders it; (c) object_id carries ON DELETE CASCADE, which drizzle-kit
-- dropped from its ALTER TABLE output.
CREATE TABLE `media_object` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`xref` text,
	`privacy` text DEFAULT 'auto' NOT NULL,
	`gedcom_extra` text,
	`created_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_object_tree` ON `media_object` (`tree_id`);--> statement-breakpoint
ALTER TABLE `media_links` ADD `fact_id` text;--> statement-breakpoint
ALTER TABLE `media_links` ADD `sort_order` integer;--> statement-breakpoint
ALTER TABLE `media_links` ADD `crop_top` integer;--> statement-breakpoint
ALTER TABLE `media_links` ADD `crop_left` integer;--> statement-breakpoint
ALTER TABLE `media_links` ADD `crop_height` integer;--> statement-breakpoint
ALTER TABLE `media_links` ADD `crop_width` integer;--> statement-breakpoint
ALTER TABLE `media_links` ADD `title` text;--> statement-breakpoint
ALTER TABLE `media_links` ADD `gedcom_extra` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_links_media_entity_fact` ON `media_links` (`media_id`,`entity_id`,coalesce(`fact_id`, ''));--> statement-breakpoint
DROP INDEX `idx_media_links_media_entity`;--> statement-breakpoint
ALTER TABLE `media_items` ADD `object_id` text REFERENCES `media_object`(`id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `media_items` ADD `sort_order` integer;--> statement-breakpoint
ALTER TABLE `media_items` ADD `gedcom_path` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `status` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `medium` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `sha256` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `crc32` integer;--> statement-breakpoint
ALTER TABLE `media_items` ADD `gedcom_extra` text;--> statement-breakpoint
CREATE INDEX `idx_media_tree_gedcom_path` ON `media_items` (`tree_id`,`gedcom_path`);
