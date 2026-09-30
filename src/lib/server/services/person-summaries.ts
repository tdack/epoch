/**
 * The short form of a person that every record page links with: a name, a sex marker and life
 * dates. Names people from the graph window when it drew them and fetches the rest, so a page never
 * shows a bare id for someone the window happened not to include.
 */

import type { EventRow, IndividualRow, PersonNameRow } from '../domain/change-log';
import type { RelationshipGraph, RelationshipGraphPerson } from '../domain/relationship-graph';
import type { GraphWindowRepository } from '../repositories/graph-window-repository';
import { displayNameWith } from '../../shared/name-types';
import { privacyOf, type PrivacyFlag } from '../../shared/privacy';
import { isSex, type Sex } from '../../shared/sex';

export interface PersonSummaryDto extends PrivacyFlag {
	id: string;
	displayName: string;
	sex: Sex | null;
	birthDate: string | null;
	deathDate: string | null;
	isDeceased: boolean;
}

/** Birth and death text of the first such fact, in the order the graph reads them. */
function vitalsOf(rows: EventRow[]): { birthDate: string | null; deathDate: string | null; isDeceased: boolean } {
	const first = (type: string) => rows.find((e) => e.type === type);
	return { birthDate: first('BIRT')?.dateRaw ?? null, deathDate: first('DEAT')?.dateRaw ?? null, isDeceased: first('DEAT') !== undefined };
}

function summaryOfGraphPerson(person: RelationshipGraphPerson): PersonSummaryDto {
	return {
		...privacyOf(person),
		id: person.id,
		displayName: person.displayName,
		sex: person.sex,
		birthDate: person.birthDate ?? null,
		deathDate: person.deathDate ?? null,
		isDeceased: person.isDeceased
	};
}

function summaryOfRows(person: IndividualRow, events: EventRow[], names: PersonNameRow[] = []): PersonSummaryDto {
	return {
		...privacyOf(person),
		id: person.id,
		displayName: displayNameWith(person, names),
		sex: isSex(person.sex) ? person.sex : 'U',
		...vitalsOf(events)
	};
}

/** A summary for every id asked for; an id that names nobody in the tree reads "Unknown". */
export async function personSummaries(
	repo: GraphWindowRepository,
	treeId: string,
	graph: RelationshipGraph,
	ids: readonly string[]
): Promise<Map<string, PersonSummaryDto>> {
	const summaries = new Map(graph.people.map((p) => [p.id, summaryOfGraphPerson(p)]));
	const missing = [...new Set(ids)].filter((id) => !summaries.has(id));
	if (missing.length > 0) {
		const [records, vitalEvents, nameRows] = await repo.run(
			repo.individualsIn(treeId, missing),
			repo.eventsOf(treeId, 'INDIVIDUAL', missing, ['BIRT', 'DEAT']),
			repo.namesOf(missing)
		);
		for (const { row } of records) {
			summaries.set(
				row.id,
				summaryOfRows(row, vitalEvents.filter((e) => e.row.entityId === row.id).map((e) => e.row), nameRows.filter((n) => n.row.personId === row.id).map((n) => n.row))
			);
		}
	}
	for (const id of ids) {
		if (!summaries.has(id)) {
			summaries.set(id, { ...privacyOf(), id, displayName: 'Unknown', sex: null, birthDate: null, deathDate: null, isDeceased: false });
		}
	}
	return summaries;
}
