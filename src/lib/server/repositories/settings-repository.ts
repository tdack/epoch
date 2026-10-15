import { eq } from 'drizzle-orm';
import type { DbClient } from '../db';
import { siteSettings, userSettings } from '../db/schema';

/**
 * Stored settings documents as JSON text: one row per user, and the one site row. The service
 * validates what is read and written; this only moves the text.
 */
export class SettingsRepository {
	constructor(private db: DbClient) {}

	async findUserData(userId: string): Promise<string | null> {
		const row = await this.db
			.select({ data: userSettings.data })
			.from(userSettings)
			.where(eq(userSettings.userId, userId))
			.get();
		return row?.data ?? null;
	}

	async saveUserData(userId: string, data: string, now: Date): Promise<void> {
		await this.db
			.insert(userSettings)
			.values({ userId, data, updatedAt: now })
			.onConflictDoUpdate({ target: userSettings.userId, set: { data, updatedAt: now } });
	}

	async findSiteData(): Promise<string | null> {
		const row = await this.db
			.select({ data: siteSettings.data })
			.from(siteSettings)
			.where(eq(siteSettings.id, 1))
			.get();
		return row?.data ?? null;
	}

	async saveSiteData(data: string, now: Date): Promise<void> {
		await this.db
			.insert(siteSettings)
			.values({ id: 1, data, updatedAt: now })
			.onConflictDoUpdate({ target: siteSettings.id, set: { data, updatedAt: now } });
	}
}
