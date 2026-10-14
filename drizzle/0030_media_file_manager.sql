PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`entity_id` text,
	`r2_object_key` text NOT NULL,
	`cf_image_id` text,
	`title` text,
	`mime_type` text NOT NULL,
	`size_bytes` integer,
	`uploaded_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_media_items`("id", "tree_id", "entity_id", "r2_object_key", "cf_image_id", "title", "mime_type", "created_at") SELECT "id", "tree_id", "entity_id", "r2_object_key", "cf_image_id", "title", "mime_type", "created_at" FROM `media_items`;--> statement-breakpoint
DROP TABLE `media_items`;--> statement-breakpoint
ALTER TABLE `__new_media_items` RENAME TO `media_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_media_entity` ON `media_items` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_media_tree` ON `media_items` (`tree_id`);--> statement-breakpoint
CREATE INDEX `idx_media_tree_key` ON `media_items` (`tree_id`,`r2_object_key`);