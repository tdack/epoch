import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGedcomToDb } from '../testing/gedcom';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { AssociationRepository } from './association-repository';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

/** Many people with kept lines and facts, one christening naming a godfather. */
function corpus(people: number): string {
	const lines = ['0 HEAD'];
	for (let i = 1; i <= people; i++)
		lines.push(`0 @I${i}@ INDI`, `1 NAME P${i} /Q/`, '1 _CUSTOM kept', '1 BIRT', '2 _CUSTOM kept');
	lines.push('0 @I0@ INDI', '1 CHR', '2 _ASSO @I1@', '3 RELA godfather', '1 ASSO @I2@', '0 TRLR');
	return lines.join('\n');
}

async function planOf(query: { toSQL(): { sql: string; params: unknown[] } }) {
	const { sql, params } = query.toSQL();
	const plan = await t.d1
		.prepare(`EXPLAIN QUERY PLAN ${sql}`)
		.bind(...params)
		.all<{ detail: string }>();
	const run = await t.d1
		.prepare(sql)
		.bind(...params)
		.run();
	return {
		details: plan.results.map((r) => r.detail).join('\n'),
		returned: run.results.length,
		rowsRead: run.meta.rows_read
	};
}

describe('the association reads', () => {
	it('read only the rows that hold an association, not every kept line of the tree', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, corpus(300), 'Plans');
		const repo = new AssociationRepository(t.db);

		const facts = await planOf(repo.factsNamingQuery(treeId, ['@I1@']));
		expect(facts.details).toContain('idx_event_asso');
		expect(facts.returned).toBe(1);
		expect(facts.rowsRead).toBeLessThan(10);

		const blocks = await planOf(repo.keptBlocksQuery(treeId, ['@I2@']));
		expect(blocks.details).toContain('idx_preserved_asso');
		expect(blocks.returned).toBe(1);
		expect(blocks.rowsRead).toBeLessThan(10);
	}, 60_000);
});
