ALTER TABLE `trees` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `trees` SET `position` = (
	SELECT count(*) FROM `trees` AS `o`
	WHERE `o`.`updated_at` > `trees`.`updated_at`
		OR (`o`.`updated_at` IS `trees`.`updated_at` AND `o`.`name` < `trees`.`name`)
);
