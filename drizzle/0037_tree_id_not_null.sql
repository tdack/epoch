-- Contract step of 0036: every row already has a tree_id (confirmed on the deployed database), so the
-- column can be NOT NULL. SQLite cannot alter nullability, hence the rebuilds. foreign_keys stays OFF
-- for all three so DROP TABLE cannot cascade into referencing rows. The person_names FTS triggers
-- (0029) die with the old table and are recreated verbatim; the copy runs before them, so it does
-- not touch name_fts.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_person_names` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`person_id` text NOT NULL,
	`type` text DEFAULT 'birth' NOT NULL,
	`given_name` text,
	`surname` text,
	`name_prefix` text,
	`name_suffix` text,
	`nickname` text,
	`surname_prefix` text,
	`gedcom_type` text,
	`gedcom_extra` text,
	`date_raw` text,
	`date_sort` text,
	`date_sort_end` text,
	`date_qualifier` text,
	`date_precision` text,
	`date_calendar` text,
	`union_id` text,
	`is_preferred` integer DEFAULT false NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `individuals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_person_names`("id", "tree_id", "person_id", "type", "given_name", "surname", "name_prefix", "name_suffix", "nickname", "surname_prefix", "gedcom_type", "gedcom_extra", "date_raw", "date_sort", "date_sort_end", "date_qualifier", "date_precision", "date_calendar", "union_id", "is_preferred", "order", "version", "created_at", "updated_at") SELECT "id", "tree_id", "person_id", "type", "given_name", "surname", "name_prefix", "name_suffix", "nickname", "surname_prefix", "gedcom_type", "gedcom_extra", "date_raw", "date_sort", "date_sort_end", "date_qualifier", "date_precision", "date_calendar", "union_id", "is_preferred", "order", "version", "created_at", "updated_at" FROM `person_names`;--> statement-breakpoint
DROP TABLE `person_names`;--> statement-breakpoint
ALTER TABLE `__new_person_names` RENAME TO `person_names`;--> statement-breakpoint
CREATE INDEX `idx_person_name_person` ON `person_names` (`person_id`);--> statement-breakpoint
CREATE TABLE `__new_union_partners` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`union_id` text NOT NULL,
	`person_id` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`union_id`) REFERENCES `unions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `individuals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_union_partners`("id", "tree_id", "union_id", "person_id", "order", "created_at") SELECT "id", "tree_id", "union_id", "person_id", "order", "created_at" FROM `union_partners`;--> statement-breakpoint
DROP TABLE `union_partners`;--> statement-breakpoint
ALTER TABLE `__new_union_partners` RENAME TO `union_partners`;--> statement-breakpoint
CREATE INDEX `idx_union_partner_union` ON `union_partners` (`union_id`);--> statement-breakpoint
CREATE INDEX `idx_union_partner_person` ON `union_partners` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_uq_union_person` ON `union_partners` (`union_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `__new_source_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`source_id` text NOT NULL,
	`repository_id` text,
	`repository_ref` text,
	`call_number` text,
	`gedcom_extra` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_source_repositories`("id", "tree_id", "source_id", "repository_id", "repository_ref", "call_number", "gedcom_extra", "sort_order", "version", "created_at", "updated_at") SELECT "id", "tree_id", "source_id", "repository_id", "repository_ref", "call_number", "gedcom_extra", "sort_order", "version", "created_at", "updated_at" FROM `source_repositories`;--> statement-breakpoint
DROP TABLE `source_repositories`;--> statement-breakpoint
ALTER TABLE `__new_source_repositories` RENAME TO `source_repositories`;--> statement-breakpoint
CREATE INDEX `idx_source_repository_source` ON `source_repositories` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_source_repository_repository` ON `source_repositories` (`repository_id`);--> statement-breakpoint
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
PRAGMA foreign_keys=ON;
