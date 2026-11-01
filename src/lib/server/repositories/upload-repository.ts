import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import { uploadSessions } from '../db/schema';
import type { UploadPurpose } from '../../shared/uploads';

type UploadStatus = 'open' | 'complete' | 'aborted' | 'imported';

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
	/** Part number to the CRC-32 of its bytes; absent for a part stored before CRCs were kept. */
	partCrcs: Record<string, number>;
	status: UploadStatus;
	createdBy: string | null;
	expiresAt: Date;
}

export type NewUploadSession = Omit<UploadSessionRow, 'parts' | 'partCrcs' | 'status'> & {
	createdAt: Date;
};

/**
 * `parts_json` holds, per part, either the bare etag (sessions opened before CRCs were kept) or
 * `{ etag, crc32 }`. Both read back the same way, so no migration is needed.
 */
function parseParts(json: string): {
	parts: Record<string, string>;
	partCrcs: Record<string, number>;
} {
	const parts: Record<string, string> = {};
	const partCrcs: Record<string, number> = {};
	try {
		const value: unknown = JSON.parse(json);
		if (value && typeof value === 'object') {
			for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
				if (typeof entry === 'string') parts[key] = entry;
				else if (entry && typeof entry === 'object') {
					const { etag, crc32 } = entry as { etag?: unknown; crc32?: unknown };
					if (typeof etag === 'string') parts[key] = etag;
					if (typeof etag === 'string' && typeof crc32 === 'number') partCrcs[key] = crc32;
				}
			}
		}
	} catch {
		// An unreadable column is an empty one: the client re-sends its parts.
	}
	return { parts, partCrcs };
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
		const row = await this.db.select().from(uploadSessions).where(eq(uploadSessions.id, id)).get();
		if (!row) return null;
		return {
			id: row.id,
			treeId: row.treeId,
			purpose: row.purpose,
			r2Key: row.r2Key,
			r2UploadId: row.r2UploadId,
			partSizeBytes: row.partSizeBytes,
			totalBytes: row.totalBytes,
			...parseParts(row.partsJson),
			status: row.status,
			createdBy: row.createdBy,
			expiresAt: row.expiresAt
		};
	}

	/**
	 * Records one part's etag (and CRC, when known) with a single `json_set`, not a read, merge and write: two parts that
	 * finish together each touch only their own key, so neither loses the other's etag. Only an open
	 * session takes a part, so a part landing after complete or abort changes nothing.
	 */
	async recordPart(
		id: string,
		partNumber: number,
		etag: string,
		crc32: number | null = null
	): Promise<void> {
		// The key is quoted because a bare numeric label is not a reliable JSON path in SQLite.
		const path = `$."${partNumber}"`;
		await this.db
			.update(uploadSessions)
			.set({
				partsJson:
					crc32 === null
						? sql`json_set(${uploadSessions.partsJson}, ${path}, ${etag})`
						: sql`json_set(${uploadSessions.partsJson}, ${path}, json(${JSON.stringify({ etag, crc32 })}))`
			})
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
	 * Hands a finished session to one import: only a `complete` session changes, so of two starts
	 * exactly one sees true. `imported` is closed for the sweep and every part, abort and complete call.
	 */
	async claimForImport(id: string): Promise<boolean> {
		const changed = await this.db
			.update(uploadSessions)
			.set({ status: 'imported' })
			.where(and(eq(uploadSessions.id, id), eq(uploadSessions.status, 'complete')))
			.returning({ id: uploadSessions.id });
		return changed.length > 0;
	}

	/**
	 * Open sessions whose expiry has passed, oldest first, at most `limit`. The `(status, expires_at)`
	 * index serves this, so a sweep costs one bounded range scan however many sessions are closed.
	 */
	async findExpiredOpen(
		now: Date,
		limit: number
	): Promise<Array<Pick<UploadSessionRow, 'id' | 'r2Key' | 'r2UploadId'>>> {
		return this.db
			.select({
				id: uploadSessions.id,
				r2Key: uploadSessions.r2Key,
				r2UploadId: uploadSessions.r2UploadId
			})
			.from(uploadSessions)
			.where(and(eq(uploadSessions.status, 'open'), lte(uploadSessions.expiresAt, now)))
			.orderBy(asc(uploadSessions.expiresAt))
			.limit(limit);
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
