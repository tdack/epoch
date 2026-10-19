import { ERROR_CODES, SetupError } from './errors.ts';

/**
 * The D1 marker, coded to migration 0025 owned by the install-owner session
 * (`drizzle/0025_install_meta.sql`, `src/lib/server/db/schema/install.ts`):
 *
 *   install_meta(install_id TEXT PRIMARY KEY NOT NULL, owner_email TEXT NOT NULL, created_at INTEGER)
 *
 * `created_at` is Drizzle's `mode: 'timestamp'`, so Unix **seconds**. `owner_email` is stored
 * lower-cased because the app compares it lower-cased with the address Access asserts. ADR-034
 * says one row is expected and the oldest wins, so this module never inserts a second one.
 * Everything that knows that shape lives here; change it in one place if their schema moves.
 */
const INSTALL_META_TABLE = 'install_meta';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@,;'"<>\\]+@[^\s@,;'"<>\\]+\.[^\s@,;'"<>\\]+$/;

/**
 * The placeholder `wrangler.deploy.jsonc` ships with. A Worker var, a hand-inserted row or an object
 * holding it says nothing about which install it belongs to, so it reads as "no marker".
 */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export function realMarker(value: string | null | undefined): string | null {
	return typeof value === 'string' && value !== '' && value.toLowerCase() !== NIL_UUID
		? value
		: null;
}

export interface InstallMeta {
	installId: string;
	ownerEmail: string;
	createdAt: Date | null;
}

/** `d1 execute --command` takes no bind parameters, so values are validated strictly and then quoted. */
function sqlText(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

export function assertUuid(value: string): string {
	if (!UUID_PATTERN.test(value)) {
		throw new SetupError(ERROR_CODES.usage, `"${value}" is not an install UUID`);
	}
	return value.toLowerCase();
}

export function readMarkerSql(): string {
	return `SELECT install_id, owner_email, created_at FROM ${INSTALL_META_TABLE} ORDER BY created_at ASC, install_id ASC LIMIT 1`;
}

/** Inserts only when the table is empty, so a re-run never adds a second owner row. */
export function insertMarkerSql(
	meta: { installId: string; ownerEmail: string },
	now: Date
): string {
	const id = assertUuid(meta.installId);
	const email = meta.ownerEmail.toLowerCase();
	if (!EMAIL_PATTERN.test(email)) {
		throw new SetupError(
			ERROR_CODES.usage,
			`"${meta.ownerEmail}" cannot be stored as the owner email`
		);
	}
	const seconds = Math.floor(now.getTime() / 1000);
	return (
		`INSERT INTO ${INSTALL_META_TABLE} (install_id, owner_email, created_at) ` +
		`SELECT ${sqlText(id)}, ${sqlText(email)}, ${seconds} ` +
		`WHERE NOT EXISTS (SELECT 1 FROM ${INSTALL_META_TABLE})`
	);
}

/** Keeps the owner current when the same install is re-run with a different owner address. */
export function updateOwnerSql(meta: { installId: string; ownerEmail: string }): string {
	const id = assertUuid(meta.installId);
	return `UPDATE ${INSTALL_META_TABLE} SET owner_email = ${sqlText(meta.ownerEmail.toLowerCase())} WHERE install_id = ${sqlText(id)}`;
}

export function parseMarkerRows(rows: unknown): InstallMeta | null {
	if (!Array.isArray(rows) || rows.length === 0) return null;
	const row = rows[0] as Record<string, unknown>;
	if (typeof row.install_id !== 'string' || typeof row.owner_email !== 'string') return null;
	return {
		installId: row.install_id,
		ownerEmail: row.owner_email,
		createdAt: typeof row.created_at === 'number' ? new Date(row.created_at * 1000) : null
	};
}

/**
 * What `./setup subdomains` made, kept in `install_meta.subdomains` (migration 0035) so a clone with
 * no manifest can find it: the exclusion routes carry no marker, and turning the subdomains off
 * takes the zone out of the deploy config, which is otherwise the only thing a fresh clone reads.
 * Only routes this install made are listed, never ones it found and kept.
 */
export interface InstallSubdomains {
	zone: { id: string; name: string };
	dnsRecordId: string | null;
	exclusionRouteIds: string[];
	isActive: boolean;
}

const CLOUDFLARE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const ZONE_NAME_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function assertCloudflareId(value: string): string {
	if (!CLOUDFLARE_ID_PATTERN.test(value))
		throw new SetupError(ERROR_CODES.usage, `"${value}" is not a Cloudflare id`);
	return value;
}

export function writeSubdomainsSql(installId: string, value: InstallSubdomains | null): string {
	const id = assertUuid(installId);
	if (value === null)
		return `UPDATE ${INSTALL_META_TABLE} SET subdomains = NULL WHERE install_id = ${sqlText(id)}`;
	if (!ZONE_NAME_PATTERN.test(value.zone.name))
		throw new SetupError(ERROR_CODES.usage, `"${value.zone.name}" is not a zone name`);
	const json = JSON.stringify({
		zone: { id: assertCloudflareId(value.zone.id), name: value.zone.name.toLowerCase() },
		dnsRecordId: value.dnsRecordId === null ? null : assertCloudflareId(value.dnsRecordId),
		exclusionRouteIds: value.exclusionRouteIds.map(assertCloudflareId),
		isActive: value.isActive
	});
	return `UPDATE ${INSTALL_META_TABLE} SET subdomains = ${sqlText(json)} WHERE install_id = ${sqlText(id)}`;
}

export function readSubdomainsSql(installId: string): string {
	return `SELECT subdomains FROM ${INSTALL_META_TABLE} WHERE install_id = ${sqlText(assertUuid(installId))}`;
}

/** Null for no row, no value, or one that does not parse: each means "nothing recorded". */
export function parseSubdomainsRows(rows: unknown): InstallSubdomains | null {
	if (!Array.isArray(rows) || rows.length === 0) return null;
	const raw = (rows[0] as Record<string, unknown>).subdomains;
	if (typeof raw !== 'string') return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof value !== 'object' || value === null) return null;
	const { zone, dnsRecordId, exclusionRouteIds, isActive } = value as Record<string, unknown>;
	const zoneRec =
		typeof zone === 'object' && zone !== null ? (zone as Record<string, unknown>) : null;
	const isId = (v: unknown): v is string => typeof v === 'string' && CLOUDFLARE_ID_PATTERN.test(v);
	if (!zoneRec || !isId(zoneRec.id) || typeof zoneRec.name !== 'string') return null;
	if (dnsRecordId !== null && !isId(dnsRecordId)) return null;
	if (!Array.isArray(exclusionRouteIds) || !exclusionRouteIds.every(isId)) return null;
	if (typeof isActive !== 'boolean') return null;
	return {
		zone: { id: zoneRec.id, name: zoneRec.name },
		dnsRecordId,
		exclusionRouteIds,
		isActive
	};
}

/** Before migration 0035 there is no `subdomains` column; setup then relies on the manifest alone. */
export function isMissingColumn(message: string): boolean {
	return /no such column/i.test(message);
}

/** Before the migration has run there is no table; that means "marker pending", not a failure. */
export function isMissingTable(message: string): boolean {
	return /no such table/i.test(message);
}

export const FINGERPRINT_SQL = {
	trees: 'SELECT count(*) AS n FROM trees',
	people: 'SELECT count(*) AS n FROM individuals',
	users: 'SELECT count(*) AS n FROM users',
	ownerEmails: 'SELECT email FROM users ORDER BY created_at ASC LIMIT 3',
	migrations: 'SELECT count(*) AS n FROM d1_migrations'
} as const;
