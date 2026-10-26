CREATE TABLE `place_match_candidates` (
	`tree_id` text NOT NULL,
	`place_id` text NOT NULL,
	`rank` integer NOT NULL,
	`score` real NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`osm_type` text,
	`osm_id` integer,
	`display_name` text NOT NULL,
	`kind` text,
	`created_at` integer,
	PRIMARY KEY(`place_id`, `rank`),
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_place_match_candidate_tree` ON `place_match_candidates` (`tree_id`);--> statement-breakpoint
CREATE TABLE `place_match_runs` (
	`tree_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`started_by` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`total_count` integer DEFAULT 0 NOT NULL,
	`searched_count` integer DEFAULT 0 NOT NULL,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`skipped_by_cap_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
