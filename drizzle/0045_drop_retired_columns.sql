DROP INDEX `idx_media_entity`;--> statement-breakpoint
ALTER TABLE `media_items` DROP COLUMN `entity_id`;--> statement-breakpoint
ALTER TABLE `trees` DROP COLUMN `default_view_mode`;
