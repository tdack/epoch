import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import type { DbClient } from '../db';
import { EvidenceRepository } from './evidence-repository';
import { NoteRepository } from './note-repository';
import { SearchRepository } from './search-repository';
import { TaskRepository, type TaskFilter } from './task-repository';

/**
 * D1 refuses a statement with more than 100 bound parameters. The visibility fragments are built
 * from many `${treeId}` and `${creatorId}` slots, so the worst case (the largest id chunk, a creator
 * test, every filter set) is compiled here and its parameter count checked, rather than found the
 * first time a large restricted tree is read in production.
 */

const dialect = new SQLiteSyncDialect();
const D1_PARAM_LIMIT = 100;
const RESTRICTED_CREATOR = {
	isRestricted: true,
	cutoff: '1906-10-01',
	creatorId: 'a-contributor'
};

/** A database that records each statement the repository would send and returns no rows. */
function capturing() {
	const statements: SQL[] = [];
	const db = {
		all: async (statement: SQL) => {
			statements.push(statement);
			return [];
		}
	};
	return { statements, db: db as unknown as DbClient };
}

const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

function paramCount(statement: SQL): number {
	return dialect.sqlToQuery(statement).params.length;
}

describe('bound parameters stay under the D1 limit for the worst statements', () => {
	it('note use counts for a full chunk of notes, restricted and with a creator', async () => {
		const { statements, db } = capturing();
		await new NoteRepository(db).visibleUseCounts('tree-a', ids(80, 'note'), RESTRICTED_CREATOR);
		expect(statements).toHaveLength(1);
		expect(paramCount(statements[0]!)).toBeLessThanOrEqual(D1_PARAM_LIMIT);
	});

	it('the task list, status counts, single task and finding tasks with every filter', async () => {
		const { statements, db } = capturing();
		const repo = new TaskRepository(db);
		const filter: TaskFilter = {
			status: 'open',
			assigneeId: 'a-user',
			subject: { kind: 'person', id: 'a-person' } as TaskFilter['subject'],
			linked: 'person'
		};
		await repo.taskIds('tree-a', filter, { offset: 0, limit: 50 }, RESTRICTED_CREATOR);
		const { status: _status, ...unfiltered } = filter;
		await repo.statusCounts('tree-a', unfiltered, RESTRICTED_CREATOR);
		await repo.visibleTask('tree-a', 'a-task', RESTRICTED_CREATOR);
		await repo.findingTasks('tree-a', RESTRICTED_CREATOR);
		expect(statements).toHaveLength(4);
		for (const statement of statements) {
			expect(paramCount(statement)).toBeLessThanOrEqual(D1_PARAM_LIMIT);
		}
	});

	it('source counts per repository for a full chunk, restricted and with a creator', async () => {
		const { statements, db } = capturing();
		await new EvidenceRepository(db).visibleSourceCounts(
			'tree-a',
			ids(80, 'repo'),
			RESTRICTED_CREATOR
		);
		expect(statements).toHaveLength(1);
		expect(paramCount(statements[0]!)).toBeLessThanOrEqual(D1_PARAM_LIMIT);
	});

	it('the cross-reference lookup with every candidate spelling of an XREF', async () => {
		const { statements, db } = capturing();
		await new SearchRepository(db).byXref('tree-a', '@i12@', RESTRICTED_CREATOR);
		expect(statements).toHaveLength(1);
		expect(paramCount(statements[0]!)).toBeLessThanOrEqual(D1_PARAM_LIMIT);
	});
});
