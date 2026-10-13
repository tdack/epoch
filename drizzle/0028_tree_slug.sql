ALTER TABLE `trees` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trees_slug` ON `trees` (`slug`);--> statement-breakpoint
-- Backfill (ADR-045): every existing tree gets a slug from its name where the name gives one.
-- A name with anything but a-z, 0-9 and hyphens left after the replacements (accents, other
-- scripts) keeps no slug and is still reached by its id. A repeated name takes part of its id as
-- a suffix rather than a counter, so it cannot collide with another tree's slug; the base is cut
-- first so the result stays within the 60 characters the app accepts.
UPDATE `trees` SET `slug` = s.slug FROM (
	SELECT id, CASE WHEN n = 1 THEN base ELSE rtrim(substr(base, 1, 53), '-') || '-' || substr(id, 1, 6) END AS slug FROM (
		SELECT id, base, row_number() OVER (PARTITION BY base ORDER BY created_at, id) AS n FROM (
			SELECT id, created_at, trim(substr(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(trim(name)), ' ', '-'), '''', '-'), '"', '-'), '.', '-'), ',', '-'), '(', '-'), ')', '-'), '&', '-'), '/', '-'), ':', '-'), ';', '-'), '!', '-'), '?', '-'), '_', '-'), '+', '-'), '’', '-'), '‘', '-'), '“', '-'), '”', '-'), '–', '-'), '—', '-'), '--', '-'), '--', '-'), '--', '-'), '--', '-'), '-'), 1, 60), '-') AS base FROM `trees`
		) WHERE base <> '' AND base NOT GLOB '*[^a-z0-9-]*'
	)
) AS s WHERE `trees`.`id` = s.id;
