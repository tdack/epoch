ALTER TABLE `person_names` ADD `tree_id` text REFERENCES trees(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `union_partners` ADD `tree_id` text REFERENCES trees(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `source_repositories` ADD `tree_id` text REFERENCES trees(id) ON DELETE cascade;--> statement-breakpoint
UPDATE `person_names` SET `tree_id` = (SELECT `tree_id` FROM `individuals` WHERE `individuals`.`id` = `person_names`.`person_id`) WHERE `tree_id` IS NULL;--> statement-breakpoint
UPDATE `union_partners` SET `tree_id` = (SELECT `tree_id` FROM `unions` WHERE `unions`.`id` = `union_partners`.`union_id`) WHERE `tree_id` IS NULL;--> statement-breakpoint
UPDATE `source_repositories` SET `tree_id` = (SELECT `tree_id` FROM `sources` WHERE `sources`.`id` = `source_repositories`.`source_id`) WHERE `tree_id` IS NULL;
