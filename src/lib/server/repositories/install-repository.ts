import { sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import { installMeta } from '../db/schema';

/** The Access application a button install's `/setup` made (ADR-082). */
export interface StoredAccessConfig {
	teamDomain: string;
	aud: string;
}

/** What `/setup` records when it claims a button install. */
export interface InstallClaim {
	installId: string;
	/** Lower-cased here whatever the caller passes, as `findOwnerEmail` compares it. */
	ownerEmail: string;
	accessTeamDomain: string;
	accessAud: string;
}

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

	/** Whether any owner is recorded; `/setup` is served only while this is false. */
	async hasOwner(): Promise<boolean> {
		return (await this.findOwnerEmail()) !== null;
	}

	/** The Access settings `/setup` stored, or null on an install made by `./setup` (whose vars hold them). */
	async findAccessConfig(): Promise<StoredAccessConfig | null> {
		const row = await this.db
			.select({ teamDomain: installMeta.accessTeamDomain, aud: installMeta.accessAud })
			.from(installMeta)
			.orderBy(installMeta.createdAt)
			.limit(1)
			.get();
		return row?.teamDomain && row.aud ? { teamDomain: row.teamDomain, aud: row.aud } : null;
	}

	/**
	 * Records the owner and Access settings only if no row exists, in one statement, so two `/setup`
	 * submissions racing each other cannot both claim the install. True when this call claimed it.
	 */
	async claim(claim: InstallClaim): Promise<boolean> {
		const result = await this.db.run(sql`
			insert into install_meta (install_id, owner_email, created_at, access_team_domain, access_aud)
			select ${claim.installId}, ${claim.ownerEmail.trim().toLowerCase()},
				${Math.floor(Date.now() / 1000)}, ${claim.accessTeamDomain}, ${claim.accessAud}
			where not exists (select 1 from install_meta)
		`);
		return (result.meta.changes ?? 0) > 0;
	}
}
