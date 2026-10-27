CREATE TABLE `place_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`osm_type` text,
	`osm_id` integer,
	`display_name` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "place_locations_status" CHECK("place_locations"."status" in ('confirmed','ignored')),
	CONSTRAINT "place_locations_source" CHECK("place_locations"."source" in ('gedcom','photon','manual'))
);
--> statement-breakpoint
CREATE INDEX `idx_place_location_tree` ON `place_locations` (`tree_id`);--> statement-breakpoint
-- Backfill (ADR-078): a place with no location takes the first fact (lowest rowid) at it whose
-- LATI and LONG both parse as GEDCOM coordinates (N/S and E/W prefixed, or a bare signed decimal)
-- and fall in range. Anything else is skipped, so a bad value never blocks the migration. Safe to
-- run again: a place that has a location, of any status or source, is never touched.
INSERT INTO `place_locations` (`id`, `tree_id`, `latitude`, `longitude`, `status`, `source`, `version`, `created_at`, `updated_at`)
WITH raw AS (
	SELECT e.`place_id` AS place_id, e.rowid AS rid,
		upper(substr(trim(e.`latitude`), 1, 1)) AS lc, trim(e.`latitude`) AS lt,
		upper(substr(trim(e.`longitude`), 1, 1)) AS gc, trim(e.`longitude`) AS gt
	FROM `events` e
	WHERE e.`place_id` IS NOT NULL AND e.`latitude` IS NOT NULL AND e.`longitude` IS NOT NULL
), split AS (
	SELECT place_id, rid,
		CASE WHEN lc IN ('N', 'S', '-', '+') THEN substr(lt, 2) ELSE lt END AS lr,
		CASE WHEN lc IN ('S', '-') THEN -1.0 ELSE 1.0 END AS ls,
		CASE WHEN gc IN ('E', 'W', '-', '+') THEN substr(gt, 2) ELSE gt END AS gr,
		CASE WHEN gc IN ('W', '-') THEN -1.0 ELSE 1.0 END AS gs
	FROM raw
), parsed AS (
	SELECT place_id, rid, ls * CAST(lr AS REAL) AS lat, gs * CAST(gr AS REAL) AS lng
	FROM split
	WHERE lr <> '' AND lr NOT GLOB '*[^0-9.]*' AND lr GLOB '*[0-9]*' AND length(lr) - length(replace(lr, '.', '')) <= 1
		AND gr <> '' AND gr NOT GLOB '*[^0-9.]*' AND gr GLOB '*[0-9]*' AND length(gr) - length(replace(gr, '.', '')) <= 1
), in_range AS (
	SELECT * FROM parsed WHERE lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180
)
SELECT p.`id`, p.`tree_id`, v.lat, v.lng, 'confirmed', 'gedcom', 1, unixepoch(), unixepoch()
FROM `places` p JOIN in_range v ON v.place_id = p.`id`
WHERE v.rid = (SELECT min(w.rid) FROM in_range w WHERE w.place_id = p.`id`)
ON CONFLICT (`id`) DO NOTHING;
