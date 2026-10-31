import { and, eq, gt, sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import { uploadSessions } from '../db/schema';
import type { UploadPurpose } from '../../shared/uploads';

export type UploadStatus = 'open' | 'complete' | 'aborted';

export interface UploadSessionRow {
	id: string;
	treeId: string;
	purpose: UploadPurpose;
	r2Key: string;
	r2UploadId: string;
	partSizeBytes: number;
	totalBytes: number;
	/** Part number to the etag R2 returned for it. */
	parts: Record<string, string>;
	status: UploadStatus;
	createdBy: string | null;
	expiresAt: Date;
}

export type NewUploadSession = Omit<UploadSessionRow, 'parts' | 'status'> & { createdAt: Date };

function parseParts(json: string): Record<string, string> {
	try {
		const value: unknown = JSON.parse(json);
		return value && typeof value === 'object' ? (value as Record<string, string>) : {};
	} catch {
		return {};
	}
}

export class UploadRepository {
	constructor(private db: DbClient) {}

	async insert(session: NewUploadSession): Promise<void> {
		await this.db.insert(uploadSessions).values({
			id: session.id,
			treeId: session.treeId,
			purpose: session.purpose,
			r2Key: session.r2Key,
			r2UploadId: session.r2UploadId,
			partSizeBytes: session.partSizeBytes,
			totalBytes: session.totalBytes,
			createdBy: session.createdBy,
			createdAt: session.createdAt,
			expiresAt: session.expiresAt
		});
	}

	async find(id: string): Promise<UploadSessionRow | null> {
		const row = await this.db
			.select()
			.from(uploadSessions)
			.where(eq(uploadSessions.id, id))
			.get();
		if (!row) return null;
		return {
			id: row.id,
			treeId: row.treeId,
			purpose: row.purpose,
			r2Key: row.r2Key,
			r2UploadId: row.r2UploadId,
			partSizeBytes: row.partSizeBytes,
			totalBytes: row.totalBytes,
			parts: parseParts(row.partsJson),
			status: row.status,
			createdBy: row.createdBy,
			expiresAt: row.expiresAt
		};
	}

	/**
	 * Records one part's etag with a single `json_set`, not a read, merge and write: two parts that
	 * finish together each touch only their own key, so neither loses the other's etag. Only an open
	 * session takes a part, so a part landing after complete or abort changes nothing.
	 */
	async recordPart(id: string, partNumber: number, etag: string): Promise<void> {
		// The key is quoted because a bare numeric label is not a reliable JSON path in SQLite.
		const path = `$."${partNumber}"`;
		await this.db
			.update(uploadSessions)
			.set({ partsJson: sql`json_set(${uploadSessions.partsJson}, ${path}, ${etag})` })
			.where(and(eq(uploadSessions.id, id), eq(uploadSessions.status, 'open')));
	}

	/**
	 * Moves an open session to `status`; answers whether this call made the change, so a repeat
	 * (a double complete, a second abort) is told apart from the first.
	 */
	async closeOpen(id: string, status: 'complete' | 'aborted'): Promise<boolean> {
		const changed = await this.db
			.update(uploadSessions)
			.set({ status })
			.where(and(eq(uploadSessions.id, id), eq(uploadSessions.status, 'open')))
			.returning({ id: uploadSessions.id });
		return changed.length > 0;
	}

	/**
	 * Bytes reserved by a tree's sessions that are open and not expired. Counted against the
	 * tree's quota so parallel sessions cannot each pass the check and together overrun it.
	 */
	async reservedBytes(treeId: string, purpose: UploadPurpose, now: Date): Promise<number> {
		const row = await this.db
			.select({ total: sql<number>`coalesce(sum(${uploadSessions.totalBytes}), 0)` })
			.from(uploadSessions)
			.where(
				and(
					eq(uploadSessions.treeId, treeId),
					eq(uploadSessions.purpose, purpose),
					eq(uploadSessions.status, 'open'),
					gt(uploadSessions.expiresAt, now)
				)
			)
			.get();
		return Number(row?.total ?? 0);
	}
}
