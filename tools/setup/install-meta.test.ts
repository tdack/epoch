import { describe, expect, it } from 'vitest';
import {
	assertUuid,
	insertMarkerSql,
	isMissingTable,
	parseMarkerRows,
	readMarkerSql,
	updateOwnerSql
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
