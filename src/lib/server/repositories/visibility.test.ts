import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { ident, literalList } from './visibility';

describe('ident', () => {
	it('accepts a bare lower-case alias or column name', () => {
		expect(ident('ip')).toBeDefined();
		expect(ident('up')).toBeDefined();
	});

	it.each(['x; drop table y', 'a.b', '', 'A', '1a', 'a b'])('rejects %j', (name) => {
		expect(() => ident(name)).toThrow(/not an identifier/);
	});
});

describe('literalList', () => {
	it('renders each event type as a quoted literal', () => {
		const query = new SQLiteSyncDialect().sqlToQuery(literalList(['BIRT', 'CHR']));
		expect(query.sql).toBe("'BIRT', 'CHR'");
		expect(query.params).toEqual([]);
	});

	it.each(["BIRT'", 'birt', 'BIRTHDAY', "BI'RT", ''])('rejects %j', (type) => {
		expect(() => literalList([type])).toThrow(/not an event type/);
	});
});
