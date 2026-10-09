/**
 * Standardising dates: rewriting every date that has a standard GEDCOM spelling meaning the same
 * date (`3 RD DECEMBER 1996` → `3 DEC 1996`) in one change with one undo. It sweeps the whole tree,
 * private people included, so it is a manager's action, like the export (`tree:update_settings`):
 * the preview lists each date before and after, which a role that cannot see everyone must not read.
 */

import type { DbClient } from '../db';
import type { TreeRows } from '../domain/change-log';
import { describeCommand } from '../domain/command-summary';
import { dateRewrites, type DateCommand, type DateRewrite } from '../domain/date-ops';
import type { AuthenticatedContext } from '../domain/identity';
import { eventLabel } from '../domain/tree-labels';
import { MAX_DATE_REWRITES, type DateTidyPreview } from '../../shared/date-tidy';
import { formatFullName } from '../../shared/name-types';
import { personName } from './kinship-service';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';

const COMMAND: DateCommand = { kind: 'standardise_dates' };

/** What a date is on, in words: "Death of Ann Ash", "Name Ann Smith of Ann Ash", "Citation of …". */
function labelOf(rows: TreeRows, rewrite: DateRewrite): string {
	const nameOf = (id: string) => {
		const person = rows.individuals.find((p) => p.id === id);
		return person ? personName(person) : 'someone';
	};
	const partnersOf = (unionId: string) =>
		rows.unionPartners
			.filter((p) => p.unionId === unionId)
			.map((p) => nameOf(p.personId))
			.join(' and ') || 'a partnership';
	if (rewrite.table === 'events') {
		const fact = rewrite.row;
		const owner =
			fact.entityType === 'INDIVIDUAL' ? nameOf(fact.entityId) : partnersOf(fact.entityId);
		return `${eventLabel(fact.type)} of ${owner}`;
	}
	if (rewrite.table === 'person_names') {
		return `Name ${formatFullName(rewrite.row)} of ${nameOf(rewrite.row.personId)}`;
	}
	const source = rows.sources.find((s) => s.id === rewrite.row.sourceId);
	return `Citation of ${source?.title ? `“${source.title}”` : 'a source'}`;
}

export class DateService {
	readonly runner: MutationRunner;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
	}

	/** Every date this turn would rewrite, before and after, and how many are left for the next. */
	async previewStandardise(
		treeId: string,
		context: AuthenticatedContext
	): Promise<DateTidyPreview> {
		await this.runner.scopeFor(treeId, context, 'tree:update_settings');
		const rows = await this.runner.store.loadRows(treeId);
		const all = dateRewrites(rows);
		return {
			changes: all.slice(0, MAX_DATE_REWRITES).map((rewrite) => ({
				label: labelOf(rows, rewrite),
				before: rewrite.before,
				after: rewrite.after
			})),
			remaining: Math.max(0, all.length - MAX_DATE_REWRITES)
		};
	}

	/** Rewrite them: one change, one undo. Answers how many are left for another turn. */
	async standardise(
		treeId: string,
		context: AuthenticatedContext
	): Promise<MutationResult & { remaining: number }> {
		await this.runner.scopeFor(treeId, context, 'tree:update_settings');
		const result = await this.runner.run(treeId, context, {
			kind: COMMAND.kind,
			summary: (rows) => describeCommand(COMMAND, rows),
			commands: [COMMAND]
		});
		const remaining = dateRewrites(await this.runner.store.loadRows(treeId)).length;
		return { ...result, remaining };
	}
}
