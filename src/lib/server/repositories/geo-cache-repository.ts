import { eq } from 'drizzle-orm';
import type { DbClient } from '../db';
import { geoCache } from '../db/schema';

/** Cached geocoder answers as JSON text. The service parses and trims; this only moves the text. */
export class GeoCacheRepository {
	constructor(private db: DbClient) {}

	async find(key: string): Promise<string | null> {
		const row = await this.db
			.select({ results: geoCache.results })
			.from(geoCache)
			.where(eq(geoCache.key, key))
			.get();
		return row?.results ?? null;
	}

	/** Two requests racing for the same key store the same answer, so the second is dropped. */
	async save(key: string, results: string, now: Date): Promise<void> {
		await this.db.insert(geoCache).values({ key, results, createdAt: now }).onConflictDoNothing();
	}
}
