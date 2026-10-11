ALTER TABLE `trees` ADD `is_public` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `trees` ADD `public_since` integer;--> statement-breakpoint
ALTER TABLE `trees` ADD `published_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trees_one_public` ON `trees` (`is_public`) WHERE is_public = 1;