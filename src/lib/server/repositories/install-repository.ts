import type { DbClient } from '../db';
import { installMeta } from '../db/schema';

export class InstallRepository {
	constructor(private db: DbClient) {}

	/**
	 * The install owner's address, lower-cased, or null before setup has written the row. Should
	 * more than one row exist, the oldest wins, so a stray second insert cannot take over the install.
	 */
	async findOwnerEmail(): Promise<string | null> {
		const row = await this.db
			.select({ ownerEmail: installMeta.ownerEmail })
			.from(installMeta)
			.orderBy(installMeta.createdAt)
			.limit(1)
			.get();
		return row ? row.ownerEmail.trim().toLowerCase() : null;
	}
}
