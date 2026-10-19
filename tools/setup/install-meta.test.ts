import { describe, expect, it } from 'vitest';
import {
	assertUuid,
	insertMarkerSql,
	isMissingColumn,
	isMissingTable,
	parseMarkerRows,
	parseSubdomainsRows,
	readMarkerSql,
	readSubdomainsSql,
	updateOwnerSql,
	writeSubdomainsSql,
	type InstallSubdomains
} from './install-meta.ts';

const meta = { installId: '11111111-1111-4111-8111-111111111111', ownerEmail: 'Owner@Example.com' };

describe('the install_meta marker (coded to migration 0025)', () => {
	it('inserts only into an empty table, lower-cases the owner and stores seconds', () => {
		expect(insertMarkerSql(meta, new Date('2026-10-09T00:00:00Z'))).toBe(
			"INSERT INTO install_meta (install_id, owner_email, created_at) SELECT '11111111-1111-4111-8111-111111111111', 'owner@example.com', 1791504000 WHERE NOT EXISTS (SELECT 1 FROM install_meta)"
		);
	});

	it('reads the oldest row, which is the one the app trusts (ADR-034)', () => {
		expect(readMarkerSql()).toContain('ORDER BY created_at ASC');
		expect(readMarkerSql()).toContain('LIMIT 1');
	});

	it('updates the owner of this install only', () => {
		expect(updateOwnerSql(meta)).toBe(
			"UPDATE install_meta SET owner_email = 'owner@example.com' WHERE install_id = '11111111-1111-4111-8111-111111111111'"
		);
	});

	it('refuses anything that is not a UUID or an email before it can reach a SQL string', () => {
		expect(() => assertUuid("x'; DROP TABLE users; --")).toThrow('not an install UUID');
		expect(() =>
			insertMarkerSql({ ...meta, ownerEmail: "o'brien@example.com" }, new Date())
		).toThrow('cannot be stored');
		expect(() => insertMarkerSql({ installId: 'nope', ownerEmail: 'a@b.co' }, new Date())).toThrow(
			'UUID'
		);
	});

	it('parses a row, converting seconds to a date', () => {
		expect(
			parseMarkerRows([
				{ install_id: meta.installId, owner_email: 'a@b.co', created_at: 1791504000 }
			])
		).toEqual({
			installId: meta.installId,
			ownerEmail: 'a@b.co',
			createdAt: new Date('2026-10-09T00:00:00Z')
		});
		expect(parseMarkerRows([])).toBeNull();
		expect(parseMarkerRows([{ install_id: 1 }])).toBeNull();
	});

	it('treats a missing table as "marker pending"', () => {
		expect(isMissingTable('D1_ERROR: no such table: install_meta: SQLITE_ERROR')).toBe(true);
		expect(isMissingTable('network down')).toBe(false);
	});
});

describe('the tree subdomains kept in install_meta (migration 0035)', () => {
	const recorded: InstallSubdomains = {
		zone: { id: 'a'.repeat(32), name: 'Example.com' },
		dnsRecordId: 'b'.repeat(32),
		exclusionRouteIds: ['c'.repeat(32)],
		isActive: false
	};

	it('writes this install’s row only, as JSON that reads back the same', () => {
		const sql = writeSubdomainsSql(meta.installId, recorded);
		expect(sql).toMatch(
			/^UPDATE install_meta SET subdomains = '.*' WHERE install_id = '11111111-1111-4111-8111-111111111111'$/
		);
		const json = sql.slice(sql.indexOf("'") + 1, sql.indexOf("' WHERE"));
		expect(parseSubdomainsRows([{ subdomains: json }])).toEqual({
			...recorded,
			zone: { id: 'a'.repeat(32), name: 'example.com' }
		});
		expect(readSubdomainsSql(meta.installId)).toBe(
			"SELECT subdomains FROM install_meta WHERE install_id = '11111111-1111-4111-8111-111111111111'"
		);
	});

	it('clears the value when the subdomains are removed', () => {
		expect(writeSubdomainsSql(meta.installId, null)).toBe(
			"UPDATE install_meta SET subdomains = NULL WHERE install_id = '11111111-1111-4111-8111-111111111111'"
		);
	});

	it('refuses an id or zone name that could carry SQL', () => {
		expect(() =>
			writeSubdomainsSql(meta.installId, {
				...recorded,
				exclusionRouteIds: ["x'; DROP TABLE users; --"]
			})
		).toThrow('is not a Cloudflare id');
		expect(() =>
			writeSubdomainsSql(meta.installId, {
				...recorded,
				zone: { id: 'a'.repeat(32), name: "a'.com" }
			})
		).toThrow('is not a zone name');
	});

	it('reads no row, no value or a malformed value as nothing recorded', () => {
		expect(parseSubdomainsRows([])).toBeNull();
		expect(parseSubdomainsRows([{ subdomains: null }])).toBeNull();
		expect(parseSubdomainsRows([{ subdomains: '{not json' }])).toBeNull();
		expect(
			parseSubdomainsRows([
				{ subdomains: JSON.stringify({ ...recorded, exclusionRouteIds: ['nope'] }) }
			])
		).toBeNull();
	});

	it('treats a missing column as "not migrated yet"', () => {
		expect(isMissingColumn('D1_ERROR: no such column: subdomains: SQLITE_ERROR')).toBe(true);
		expect(isMissingColumn('no such table: install_meta')).toBe(false);
	});
});
