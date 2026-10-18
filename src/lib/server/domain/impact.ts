/**
 * The preview of a change: exactly which people, partnerships, links and events it creates,
 * updates or deletes. Computed from the ops that will be written, so the list cannot drift from
 * what the save does.
 */

import {
	describeOps,
	type CitationRow,
	type EventRow,
	type ParentChildRow,
	type PersonNameRow,
	type RowOp,
	type TreeRows
} from './change-log';
import {
	PERSON_ROLES_IN_IMPACT,
	type ImpactMove,
	type ImpactPersonRole,
	type ImpactSummary
} from '../../shared/impact';
import { ENTITY_ORDER } from '../../shared/impact-groups';
import { makeLabeler } from './tree-labels';

import { displayNameOf, personName } from './tree-ops';

/** A row a citation or note can be about, with what it is, so a lookup by kind narrows the row. */
type Subject =
	| { kind: 'name'; row: PersonNameRow }
	| { kind: 'event'; row: EventRow }
	| { kind: 'parent_child'; row: ParentChildRow }
	| { kind: 'citation'; row: CitationRow };

/** Every person a row belongs to or points at; a partnership belongs to its partners. */
function peopleOf(
	op: RowOp,
	partnersOf: (unionId: string) => string[],
	subjectPeople: (kind: string, id: string) => string[],
	fileOwnerPeople: (entityId: string) => string[]
): string[] {
	switch (op.table) {
		case 'individuals':
			return [op.id];
		case 'unions':
			return partnersOf(op.id);
		case 'person_names':
		case 'union_partners':
			return [(op.after ?? op.before)!.personId];
		case 'parent_child': {
			const row = (op.after ?? op.before)!;
			return [row.parentId, row.childId];
		}
		case 'events': {
			const row = (op.after ?? op.before)!;
			return row.entityType === 'INDIVIDUAL' ? [row.entityId] : partnersOf(row.entityId);
		}
		case 'media_items': {
			const row = (op.after ?? op.before)!;
			// A detached file touches no person; a file of a partnership touches its partners.
			return row.entityId === null ? [] : fileOwnerPeople(row.entityId);
		}
		case 'citations':
		case 'note_attachments': {
			const row = (op.after ?? op.before)!;
			return subjectPeople(row.subjectKind, row.subjectId);
		}
		case 'sources':
		case 'repositories':
		case 'source_repositories':
		case 'notes':
		case 'research_tasks':
			// Records of the library, not of any person; who they matter to is what cites or attaches them.
			return [];
	}
}

export function describeImpact(headline: string, rows: TreeRows, ops: RowOp[]): ImpactSummary {
	const labeler = makeLabeler(rows, ops);
	const records = describeOps(ops, labeler).sort(
		(a, b) => ENTITY_ORDER.indexOf(a.entityType) - ENTITY_ORDER.indexOf(b.entityType)
	);

	const names = new Map(rows.individuals.map((p) => [p.id, displayNameOf(rows, p.id)]));
	for (const op of ops)
		if (op.table === 'individuals' && op.after) names.set(op.id, personName(op.after));

	// Partners as they are before the change plus those it adds, so a deleted partnership still names them.
	const partnerIds = new Map<string, string[]>();
	for (const p of rows.unionPartners)
		partnerIds.set(p.unionId, [...(partnerIds.get(p.unionId) ?? []), p.personId]);
	for (const op of ops) {
		if (op.table === 'union_partners' && op.before === null) {
			const row = op.after!;
			partnerIds.set(row.unionId, [...(partnerIds.get(row.unionId) ?? []), row.personId]);
		}
	}
	const partnersOf = (unionId: string) => partnerIds.get(unionId) ?? [];
	// A file's owner is a person, a partnership or a source (a library record, so no person). A partnership with nobody in it is still a
	// partnership, so the test is whether the id is one, not whether it has partners.
	const unionIds = new Set([
		...rows.unions.map((u) => u.id),
		...ops.filter((op) => op.table === 'unions' && op.after).map((op) => op.id)
	]);
	const sourceIds = new Set(rows.sources.map((s) => s.id));
	const fileOwnerPeople = (entityId: string) =>
		sourceIds.has(entityId) ? [] : unionIds.has(entityId) ? partnersOf(entityId) : [entityId];

	// The people a citation is about, from its subject, whether the change creates, keeps or deletes it.
	const subjects = new Map<string, Subject>();
	for (const r of rows.personNames) subjects.set(`name|${r.id}`, { kind: 'name', row: r });
	for (const r of rows.events) subjects.set(`event|${r.id}`, { kind: 'event', row: r });
	for (const r of rows.parentChild)
		subjects.set(`parent_child|${r.id}`, { kind: 'parent_child', row: r });
	for (const r of rows.citations) subjects.set(`citation|${r.id}`, { kind: 'citation', row: r });
	for (const op of ops) {
		if (!op.after) continue;
		switch (op.table) {
			case 'person_names':
				subjects.set(`name|${op.id}`, { kind: 'name', row: op.after });
				break;
			case 'events':
				subjects.set(`event|${op.id}`, { kind: 'event', row: op.after });
				break;
			case 'parent_child':
				subjects.set(`parent_child|${op.id}`, { kind: 'parent_child', row: op.after });
				break;
			case 'citations':
				subjects.set(`citation|${op.id}`, { kind: 'citation', row: op.after });
				break;
		}
	}
	const subjectPeople = (kind: string, id: string): string[] => {
		if (kind === 'person') return [id];
		if (kind === 'union') return partnersOf(id);
		const subject = subjects.get(`${kind}|${id}`);
		if (!subject) return [];
		switch (subject.kind) {
			// A note on a citation is about whoever the citation is.
			case 'citation':
				return subjectPeople(subject.row.subjectKind, subject.row.subjectId);
			case 'name':
				return [subject.row.personId];
			case 'event':
				return subject.row.entityType === 'INDIVIDUAL'
					? [subject.row.entityId]
					: partnersOf(subject.row.entityId);
			case 'parent_child':
				return [subject.row.parentId, subject.row.childId];
		}
	};

	const roles = new Map<string, ImpactPersonRole>();
	for (const op of ops) {
		if (op.table === 'individuals' && op.before === null)
			roles.set(op.id, PERSON_ROLES_IN_IMPACT.CREATED);
		else if (op.table === 'individuals' && op.after === null)
			roles.set(op.id, PERSON_ROLES_IN_IMPACT.DELETED);
	}
	for (const op of ops) {
		for (const id of peopleOf(op, partnersOf, subjectPeople, fileOwnerPeople))
			if (!roles.has(id)) roles.set(id, PERSON_ROLES_IN_IMPACT.AFFECTED);
	}
	const people = [...roles].map(([id, role]) => ({ id, name: names.get(id) ?? 'Unknown', role }));

	const unionLabel = (id: unknown) =>
		typeof id === 'string' ? labeler('unions', { id }) : 'no partnership';
	const moves: ImpactMove[] = [];
	for (const op of ops) {
		if (!op.before || !op.after) continue;
		const [from, to] =
			op.table === 'parent_child'
				? [op.before.unionId, op.after.unionId]
				: op.table === 'events' && op.before.entityType === 'FAMILY'
					? [op.before.entityId, op.after.entityId]
					: [null, null];
		if (from === to) continue;
		moves.push({
			entityType: op.table === 'events' ? 'event' : 'link',
			entityId: op.id,
			label: labeler(op.table, op.after),
			from: unionLabel(from),
			to: unionLabel(to)
		});
	}

	return {
		headline,
		records,
		moves,
		people,
		isDestructive: records.some((r) => r.action === 'deleted')
	};
}
