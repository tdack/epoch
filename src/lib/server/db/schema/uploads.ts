import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

// A resumable multipart upload to R2. `r2_upload_id` is the provider's upload id and `parts_json`
// maps each part number to the etag R2 returned for it, so a client can resume after a dropped
// connection and the final complete call can name every part. `expires_at` lets a sweep find
// sessions that were never completed or aborted and abort them now, rather than leaving their
// parts in R2 until a bucket lifecycle rule would remove them.
export const uploadSessions = sqliteTable(
	'upload_session',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		purpose: text('purpose', { enum: ['gedzip_import', 'media'] }).notNull(),
		r2Key: text('r2_key').notNull(),
		r2UploadId: text('r2_upload_id').notNull(),
		// Fixed when the session opens, so every part but the last is the same size and a part's
		// offset is derived from its number.
		partSizeBytes: integer('part_size_bytes').notNull(),
		totalBytes: integer('total_bytes').notNull(),
		partsJson: text('parts_json').notNull().default('{}'),
		status: text('status', { enum: ['open', 'complete', 'aborted'] })
			.notNull()
			.default('open'),
		// No FK, like `media_items.uploaded_by`: an uploader who leaves the tree must not abandon
		// or orphan an upload in progress.
		createdBy: text('created_by'),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
	},
	(table) => ({
		treeCreatedIdx: index('idx_upload_session_tree_created').on(table.treeId, table.createdAt),
		statusExpiresIdx: index('idx_upload_session_status_expires').on(table.status, table.expiresAt)
	})
);
