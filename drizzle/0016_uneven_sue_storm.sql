CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_place_key` ON `places` (`tree_id`,`name_key`);--> statement-breakpoint
ALTER TABLE `events` ADD `place_id` text REFERENCES places(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_event_place_id` ON `events` (`place_id`);--> statement-breakpoint
-- Backfill (ADR-019): one record per tree and ASCII-case-insensitive place text, then each fact
-- points at its record. Expand-only: code that does not read `place_id` is unaffected. Safe to run
-- again if it stops part way.
INSERT INTO `places` (`id`, `tree_id`, `name_key`, `created_at`)
SELECT lower(hex(randomblob(16))), `tree_id`, lower(`place`), unixepoch()
FROM `events` WHERE `place` IS NOT NULL AND `place` <> '' GROUP BY `tree_id`, lower(`place`)
ON CONFLICT (`tree_id`, `name_key`) DO NOTHING;--> statement-breakpoint
UPDATE `events` SET `place_id` = (SELECT p.`id` FROM `places` p WHERE p.`tree_id` = `events`.`tree_id` AND p.`name_key` = lower(`events`.`place`))
WHERE `place` IS NOT NULL AND `place` <> '';
