ALTER TABLE `events` ADD `value` text;--> statement-breakpoint
ALTER TABLE `events` ADD `cause` text;--> statement-breakpoint
ALTER TABLE `events` ADD `age` text;--> statement-breakpoint
ALTER TABLE `events` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `events` ADD `sort_order` integer DEFAULT 0 NOT NULL;