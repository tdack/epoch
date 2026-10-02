/**
 * Merging two records of one person (Phase 5 item 5, ADR-022): a side-by-side review, an exact
 * preview, and the merge itself as one change with one undo.
 *
 * It deletes a record, so it needs the rights deleting needs (an editor), which also means the
 * caller sees every person; the review still reads the rows through the viewer's scope so it can
 * never be a way round privacy. Favourites and recents are per user and not in the change log, so
 * they are copied to the survivor and the originals left: an undo brings the other person back with
 * their own, and the survivor keeps a copy that is harmless.
 */

import type { DbClient } from '../db';
import { describeCommand } from '../domain/command-summary';
import type { RowOp, TreeRows } from '../domain/change-log';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { ImpactSummary } from '../domain/impact';
import { buildPersonMergeOps, personMergeConflicts, personMergeRefusal, type PersonMergeCommand } from '../domain/person-merge';
import { eventLabel } from '../domain/tree-labels';
import { applyOpsToRows, personName } from '../domain/tree-ops';
import { MarkRepository } from '../repositories/mark-repository';
import { formatFullName } from '../../shared/name-types';
import type { MergeSideDto, PersonMergeChoices, PersonMergeReviewDto } from '../../shared/person-merge';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';

export interface PersonMergeRequest {
	survivorId: string;
	mergedId: string;
	keep?: PersonMergeChoices;
	/** Version of each person as the review showed it. */
	expectedVersions?: Record<string, number>;
}

const commandOf = (request: PersonMergeRequest): PersonMergeCommand => ({ kind: 'merge_people', ...request });

function sideOf(rows: TreeRows, personId: string): MergeSideDto {
	const person = rows.individuals.find((p) => p.id === personId);
	if (!person) throw new NotFoundError('Person', personId);
	const nameOf = (id: string) => {
		const row = rows.individuals.find((p) => p.id === id);
		return row ? personName(row) : 'Unknown';
	};
	const partnersOf = (unionId: string) => rows.unionPartners.filter((p) => p.unionId === unionId).map((p) => p.personId);
	const unionIds = [...new Set(rows.unionPartners.filter((p) => p.personId === personId).map((p) => p.unionId))];
	return {
		id: person.id,
		name: personName(person),
		sex: person.sex ?? null,
		version: person.version,
		names: rows.personNames
			.filter((n) => n.personId === personId)
			.sort((a, b) => a.order - b.order)
			.map((n) => ({ text: formatFullName({ prefix: n.namePrefix, givenName: n.givenName, surnamePrefix: n.surnamePrefix, surname: n.surname, suffix: n.nameSuffix }), type: n.type, isPreferred: n.isPreferred })),
		facts: rows.events
			.filter((e) => e.entityType === 'INDIVIDUAL' && e.entityId === personId)
			.map((e) => ({ label: eventLabel(e.type), text: [e.dateRaw, e.place, e.value ?? e.description].filter(Boolean).join(', ') || 'No details' })),
		parents: rows.parentChild.filter((l) => l.childId === personId).map((l) => ({ id: l.parentId, name: nameOf(l.parentId), type: l.type })),
		partnerships: unionIds.map((id) => ({
			id,
			partners: partnersOf(id).filter((p) => p !== personId).map(nameOf).join(' and ') || 'No other partner recorded',
			childCount: new Set(rows.parentChild.filter((l) => l.unionId === id).map((l) => l.childId)).size
		})),
		children: [...new Set(rows.parentChild.filter((l) => l.parentId === personId).map((l) => l.childId))].map((id) => ({ id, name: nameOf(id) })),
		mediaCount: rows.mediaItems.filter((m) => m.entityId === personId).length
	};
}

/** What the result will hold that is worth a second look; computed from the rows the merge would leave. */
function notesFor(rows: TreeRows, ops: RowOp[], survivorId: string): string[] {
	const after = applyOpsToRows(rows, ops);
	const name = personName(after.individuals.find((p) => p.id === survivorId)!);
	const notes: string[] = [];
	for (const [type, word] of [['BIRT', 'births'], ['DEAT', 'deaths']] as const) {
		const facts = after.events.filter((e) => e.entityType === 'INDIVIDUAL' && e.entityId === survivorId && e.type === type);
		if (facts.length > 1) notes.push(`${name} will have ${facts.length} ${word} recorded (${facts.map((f) => f.dateRaw ?? 'undated').join(', ')}). Both are kept, and the first stays the one shown.`);
	}
	const partnersOf = new Map<string, string[]>();
	for (const p of after.unionPartners) partnersOf.set(p.unionId, [...(partnersOf.get(p.unionId) ?? []), p.personId]);
	const mine = [...partnersOf].filter(([, people]) => people.includes(survivorId));
	const bySet = new Map<string, string[]>();
	for (const [unionId, people] of mine) {
		const key = [...new Set(people)].sort().join(',');
		bySet.set(key, [...(bySet.get(key) ?? []), unionId]);
	}
	for (const unionIds of bySet.values()) {
		if (unionIds.length > 1) notes.push(`${name} will have ${unionIds.length} partnerships with the same partners. They stay separate; merge them from either partnership if they are one.`);
	}
	return notes;
}

export class PersonMergeService {
	readonly runner: MutationRunner;
	private marks: MarkRepository;

	constructor(
		private db: DbClient,
		clock?: MutationClock
	) {
		this.runner = new MutationRunner(db, clock);
		this.marks = new MarkRepository(db);
	}

	/** Both records side by side, whether they can be merged and what must be chosen first. Writes nothing. */
	async review(treeId: string, request: PersonMergeRequest, context: AuthenticatedContext): Promise<PersonMergeReviewDto> {
		const { visible, ops } = await this.planned(treeId, request, context);
		const refusal = personMergeRefusal(visible, request.survivorId, request.mergedId);
		const conflicts = refusal ? [] : personMergeConflicts(visible, request.survivorId, request.mergedId);
		return {
			survivor: sideOf(visible, request.survivorId),
			merged: sideOf(visible, request.mergedId),
			refusal,
			conflicts,
			notes: ops ? notesFor(visible, ops, request.survivorId) : []
		};
	}

	/** What the merge would write, exactly. Needs the same rights as the merge. */
	async preview(treeId: string, request: PersonMergeRequest, context: AuthenticatedContext): Promise<ImpactSummary> {
		const command = commandOf(request);
		return this.runner.preview(treeId, context, [command], (rows) => describeCommand(command, rows));
	}

	async merge(treeId: string, request: PersonMergeRequest, context: AuthenticatedContext): Promise<MutationResult> {
		const command = commandOf(request);
		const result = await this.runner.run(treeId, context, { kind: command.kind, summary: (rows) => describeCommand(command, rows), commands: [command] });
		await this.marks.copyPerson(treeId, request.mergedId, request.survivorId);
		return result;
	}

	/** The rows as the caller may see them, and the ops when the merge is plannable (no refusal, no open choice). */
	private async planned(treeId: string, request: PersonMergeRequest, context: AuthenticatedContext) {
		const scope = await this.runner.scopeFor(treeId, context, 'record:delete');
		const rows = await this.runner.store.loadRows(treeId);
		const visible = this.runner.visibleRows(rows, scope);
		const refusal = personMergeRefusal(visible, request.survivorId, request.mergedId);
		const isOpen = personMergeConflicts(visible, request.survivorId, request.mergedId).length > 0 && !request.keep?.sex;
		const ops = refusal || isOpen ? null : buildPersonMergeOps(visible, commandOf(request), { treeId, now: this.runner.clock.now(), newId: this.runner.clock.newId });
		return { visible, ops };
	}
}
