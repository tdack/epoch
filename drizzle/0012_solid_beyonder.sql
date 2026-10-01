ALTER TABLE `trees` ADD `max_alive_years` integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE `trees` ADD `should_show_private_structure` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `individuals` ADD `privacy` text DEFAULT 'auto' NOT NULL;