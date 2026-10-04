CREATE TABLE `note_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`note_id` text,
	`note_ref` text,
	`gedcom_tag` text,
	`text` text,
	`gedcom_extra` text,
	`gedcom_layout` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_note_attachment_subject` ON `note_attachments` (`tree_id`,`subject_kind`,`subject_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_note_attachment_note` ON `note_attachments` (`tree_id`,`note_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`tree_id` text NOT NULL,
	`xref` text,
	`xref_aliases` text,
	`text` text,
	`mime` text,
	`language` text,
	`gedcom_tag` text,
	`gedcom_extra` text,
	`gedcom_layout` text,
	`created_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_note_xref` ON `notes` (`tree_id`,`xref`);--> statement-breakpoint
CREATE INDEX `idx_note_text` ON `notes` (`tree_id`,"text" collate nocase,`id`);