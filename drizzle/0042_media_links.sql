CREATE TABLE `media_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`media_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_links_media_entity` ON `media_links` (`media_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_media_links_tree_entity` ON `media_links` (`tree_id`,`entity_id`);--> statement-breakpoint
INSERT INTO `media_links` (`id`, `tree_id`, `media_id`, `entity_id`, `created_at`) SELECT `id` || ':' || `entity_id`, `tree_id`, `id`, `entity_id`, coalesce(`created_at`, cast(strftime('%s', 'now') as integer)) FROM `media_items` WHERE `entity_id` IS NOT NULL;
