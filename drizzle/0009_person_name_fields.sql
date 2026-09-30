ALTER TABLE `person_names` ADD `nickname` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `surname_prefix` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `gedcom_type` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `gedcom_extra` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `date_raw` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `date_sort` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `date_sort_end` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `date_qualifier` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `date_precision` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `date_calendar` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `union_id` text;--> statement-breakpoint
ALTER TABLE `person_names` ADD `version` integer DEFAULT 1 NOT NULL;