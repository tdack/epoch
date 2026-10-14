-- Name search (ADR-049). Hand-written: drizzle's schema cannot express a virtual table or a trigger.
-- Expand-only: nothing reads these tables until the search code ships, and nothing else changes.
--
-- `name_fts_key` is a plain table with a stable integer id. The FTS table uses that id as its rowid,
-- because a rowid of `person_names` or `individuals` can be renumbered by VACUUM (those tables have
-- text primary keys), and a name-table rowid would then point the FTS row at the wrong name. A key
-- table indexed on `person_id` and `name_id` lets each trigger find its own FTS row without scanning
-- the FTS table, which has every tree's names and cannot be filtered by an unindexed column cheaply.
-- It has no foreign key: a cascade would delete keys before the FTS triggers look them up, and leave
-- FTS rows behind.
--
-- Two kinds of row, matching search-repository.ts: one per name (`name_id` set), and one per person
-- for the display name (`name_id` null), built from `individuals.given_name` and `surname`.
CREATE TABLE `name_fts_key` (
	`id` integer PRIMARY KEY,
	`person_id` text NOT NULL,
	`name_id` text UNIQUE
);--> statement-breakpoint
CREATE INDEX `idx_name_fts_key_person` ON `name_fts_key` (`person_id`);--> statement-breakpoint
CREATE VIRTUAL TABLE `name_fts` USING fts5(`name`, `tree_id`, `person_id` UNINDEXED, `name_id` UNINDEXED, tokenize = 'trigram remove_diacritics 1');--> statement-breakpoint
-- Backfill, one row per stored name and per person's own name. Keys first, then the FTS rows, which
-- take the key's id as their rowid so each trigger below can find its row.
INSERT INTO `name_fts_key` (`person_id`, `name_id`) SELECT `person_id`, `id` FROM `person_names`;--> statement-breakpoint
INSERT INTO `name_fts_key` (`person_id`, `name_id`) SELECT `id`, NULL FROM `individuals`;--> statement-breakpoint
INSERT INTO `name_fts` (`rowid`, `name`, `tree_id`, `person_id`, `name_id`)
SELECT k.id,
	CASE WHEN n.id IS NULL
		THEN rtrim(coalesce(i.given_name || ' ', '') || coalesce(i.surname, ''))
		ELSE rtrim(coalesce(n.name_prefix || ' ', '') || coalesce(n.given_name || ' ', '') || coalesce(n.nickname || ' ', '') || coalesce(n.surname_prefix || ' ', '') || coalesce(n.surname || ' ', '') || coalesce(n.name_suffix, ''))
	END,
	i.tree_id, k.person_id, k.name_id
FROM `name_fts_key` k
JOIN `individuals` i ON i.id = k.person_id
LEFT JOIN `person_names` n ON n.id = k.name_id;--> statement-breakpoint
CREATE TRIGGER `trg_person_names_fts_insert` AFTER INSERT ON `person_names`
BEGIN
	INSERT INTO `name_fts_key` (`person_id`, `name_id`) VALUES (NEW.`person_id`, NEW.`id`);
	INSERT INTO `name_fts` (`rowid`, `name`, `tree_id`, `person_id`, `name_id`)
	VALUES (
		(SELECT `id` FROM `name_fts_key` WHERE `name_id` = NEW.`id`),
		rtrim(coalesce(NEW.`name_prefix` || ' ', '') || coalesce(NEW.`given_name` || ' ', '') || coalesce(NEW.`nickname` || ' ', '') || coalesce(NEW.`surname_prefix` || ' ', '') || coalesce(NEW.`surname` || ' ', '') || coalesce(NEW.`name_suffix`, '')),
		(SELECT `tree_id` FROM `individuals` WHERE `id` = NEW.`person_id`),
		NEW.`person_id`,
		NEW.`id`
	);
END;--> statement-breakpoint
-- An update rewrites the name's row: the same key and FTS rowid, so no other row is touched.
-- The writers set every column of a row on update, so the WHEN keeps an edit that changes none of
-- these from rewriting the row.
CREATE TRIGGER `trg_person_names_fts_update` AFTER UPDATE OF `person_id`, `id`, `name_prefix`, `given_name`, `nickname`, `surname_prefix`, `surname`, `name_suffix` ON `person_names`
WHEN NEW.`person_id` IS NOT OLD.`person_id` OR NEW.`id` IS NOT OLD.`id` OR NEW.`name_prefix` IS NOT OLD.`name_prefix` OR NEW.`given_name` IS NOT OLD.`given_name` OR NEW.`nickname` IS NOT OLD.`nickname` OR NEW.`surname_prefix` IS NOT OLD.`surname_prefix` OR NEW.`surname` IS NOT OLD.`surname` OR NEW.`name_suffix` IS NOT OLD.`name_suffix`
BEGIN
	DELETE FROM `name_fts` WHERE rowid = (SELECT `id` FROM `name_fts_key` WHERE `name_id` = OLD.`id`);
	DELETE FROM `name_fts_key` WHERE `name_id` = OLD.`id`;
	INSERT INTO `name_fts_key` (`person_id`, `name_id`) VALUES (NEW.`person_id`, NEW.`id`);
	INSERT INTO `name_fts` (`rowid`, `name`, `tree_id`, `person_id`, `name_id`)
	VALUES (
		(SELECT `id` FROM `name_fts_key` WHERE `name_id` = NEW.`id`),
		rtrim(coalesce(NEW.`name_prefix` || ' ', '') || coalesce(NEW.`given_name` || ' ', '') || coalesce(NEW.`nickname` || ' ', '') || coalesce(NEW.`surname_prefix` || ' ', '') || coalesce(NEW.`surname` || ' ', '') || coalesce(NEW.`name_suffix`, '')),
		(SELECT `tree_id` FROM `individuals` WHERE `id` = NEW.`person_id`),
		NEW.`person_id`,
		NEW.`id`
	);
END;--> statement-breakpoint
CREATE TRIGGER `trg_person_names_fts_delete` AFTER DELETE ON `person_names`
BEGIN
	DELETE FROM `name_fts` WHERE rowid = (SELECT `id` FROM `name_fts_key` WHERE `name_id` = OLD.`id`);
	DELETE FROM `name_fts_key` WHERE `name_id` = OLD.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `trg_individuals_fts_insert` AFTER INSERT ON `individuals`
BEGIN
	INSERT INTO `name_fts_key` (`person_id`, `name_id`) VALUES (NEW.`id`, NULL);
	INSERT INTO `name_fts` (`rowid`, `name`, `tree_id`, `person_id`, `name_id`)
	VALUES (
		(SELECT `id` FROM `name_fts_key` WHERE `person_id` = NEW.`id` AND `name_id` IS NULL),
		rtrim(coalesce(NEW.`given_name` || ' ', '') || coalesce(NEW.`surname`, '')),
		NEW.`tree_id`,
		NEW.`id`,
		NULL
	);
END;--> statement-breakpoint
CREATE TRIGGER `trg_individuals_fts_own_update` AFTER UPDATE OF `given_name`, `surname` ON `individuals`
WHEN NEW.`given_name` IS NOT OLD.`given_name` OR NEW.`surname` IS NOT OLD.`surname`
BEGIN
	UPDATE `name_fts` SET `name` = rtrim(coalesce(NEW.`given_name` || ' ', '') || coalesce(NEW.`surname`, ''))
	WHERE rowid = (SELECT `id` FROM `name_fts_key` WHERE `person_id` = NEW.`id` AND `name_id` IS NULL);
END;--> statement-breakpoint
-- A person's name rows carry the tree too, so a move between trees must reach them.
CREATE TRIGGER `trg_individuals_fts_tree` AFTER UPDATE OF `tree_id` ON `individuals`
WHEN NEW.`tree_id` IS NOT OLD.`tree_id`
BEGIN
	UPDATE `name_fts` SET `tree_id` = NEW.`tree_id`
	WHERE rowid IN (SELECT `id` FROM `name_fts_key` WHERE `person_id` = NEW.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `trg_individuals_fts_delete` AFTER DELETE ON `individuals`
BEGIN
	DELETE FROM `name_fts` WHERE rowid IN (SELECT `id` FROM `name_fts_key` WHERE `person_id` = OLD.`id`);
	DELETE FROM `name_fts_key` WHERE `person_id` = OLD.`id`;
END;
