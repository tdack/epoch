/**
 * Tree search: ranked people by any name, XREF, place and date range, each result saying what
 * matched. The ranking is the repository's; this adds the record data a result shows and the
 * explanation, and is the only caller that hands results to the privacy seam.
 */

import type { DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import type { PersonNameRow } from '../domain/change-log';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { SearchRepository } from '../repositories/search-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { factLabel } from '../../shared/fact-types';
import { formatFullName } from '../../shared/name-types';
import { personName } from '../../shared/person-name';
import { privacyOf } from '../../shared/privacy';
import {
	DEFAULT_SEARCH_LIMIT,
	MAX_SEARCH_LIMIT,
	searchWords,
	type SearchMatch,
	type SearchQuery,
	type SearchResponse,
	type SearchResultDto
} from '../../shared/search';
import { summaryOfRows } from './person-summaries';
import { requireTreeScope } from './tree-access';

/** Facts listed per person; a person with forty births in Cork needs no forty lines. */
const FACTS_SHOWN_PER_PERSON = 3;

const sameText = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export class SearchService {
	private repo: SearchRepository;
	private graphRepo: GraphWindowRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.repo = new SearchRepository(db);
		this.graphRepo = new GraphWindowRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	async search(treeId: string, query: Partial<SearchQuery>, context: AuthenticatedContext): Promise<SearchResponse> {
		const scope = await requireTreeScope(this.users, this.trees, treeId, context, 'tree:view', this.now());
		const text = (query.text ?? '').trim();
		const place = (query.place ?? '').trim();
		const limit = Math.min(Math.max(query.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
		const offset = Math.max(query.offset ?? 0, 0);
		const from = (query.from ?? '').trim();
		const to = (query.to ?? '').trim();
		const words = searchWords(text);

		// An XREF is exact and is checked on the first page only; it leads, then the name hits.
		const xrefIds = offset === 0 ? await this.repo.byXref(treeId, text, scope) : [];
		const { hits, hasMore } = await this.repo.find(treeId, { words, place, from, to, limit, offset }, scope);
		if (words.length === 0 && !place && !from && !to && xrefIds.length === 0) return { people: [], hasMore: false };

		const nameIdOf = new Map(hits.map((h) => [h.personId, h.nameId]));
		// An XREF names one person; a place or year range narrows, so it keeps them only when one of
		// their facts passes the same filter the name hits already went through in SQL.
		const isNarrowed = Boolean(place || from || to);
		const xrefKept = isNarrowed
			? new Set((await this.repo.factsMatching(xrefIds, place, from, to, scope)).map((f) => f.personId))
			: new Set(xrefIds);
		const keptXrefIds = xrefIds.filter((id) => xrefKept.has(id));
		const ids = [...new Set([...keptXrefIds, ...hits.map((h) => h.personId)])];

		const [[individuals, vitalEvents, nameRows], facts] = await Promise.all([
			this.graphRepo.run(
				this.graphRepo.individualsIn(treeId, ids),
				this.graphRepo.eventsOf(treeId, 'INDIVIDUAL', ids, ['BIRT', 'DEAT']),
				this.graphRepo.namesOf(ids)
			),
			this.repo.factsMatching(ids, place, from, to, scope)
		]);
		const people = new Map(individuals.map(({ row }) => [row.id, row]));
		const eventsOfPerson = (id: string) => vitalEvents.filter((e) => e.row.entityId === id).map((e) => e.row);
		const namesOfPerson = (id: string): PersonNameRow[] => nameRows.filter((n) => n.row.personId === id).map((n) => n.row);

		const results: SearchResultDto[] = [];
		for (const id of ids) {
			const row = people.get(id);
			if (!row) continue;
			const names = namesOfPerson(id);
			const summary = summaryOfRows(row, eventsOfPerson(id), names);
			const matches: SearchMatch[] = [];
			if (keptXrefIds.includes(id)) matches.push({ kind: 'xref', text: row.xrefId ?? text });

			let matchedName: string | undefined;
			if (words.length > 0 && nameIdOf.has(id)) {
				const matched = names.find((n) => n.id === nameIdOf.get(id));
				if (matched) {
					const isDisplayName = sameText(personName(matched), personName(row));
					const match: SearchMatch = { kind: 'name', text: formatFullName({ ...matched, prefix: matched.namePrefix, suffix: matched.nameSuffix }), nameType: matched.type, isDisplayName };
					matches.push(match);
					if (!isDisplayName) matchedName = personName(matched);
				} else {
					matches.push({ kind: 'name', text: personName(row), nameType: names.find((n) => n.isPreferred)?.type ?? 'birth', isDisplayName: true });
				}
			}
			for (const fact of facts.filter((f) => f.personId === id).slice(0, FACTS_SHOWN_PER_PERSON)) {
				matches.push({
					kind: 'fact',
					factId: fact.factId,
					factType: fact.type,
					label: factLabel(fact.type),
					placeText: fact.place,
					dateText: fact.dateRaw,
					isPartnershipFact: fact.isPartnershipFact
				});
			}

			results.push({
				...privacyOf(row),
				id,
				displayName: summary.displayName,
				givenName: row.givenName,
				surname: row.surname,
				xref: row.xrefId ?? null,
				birthDate: summary.birthDate,
				deathDate: summary.deathDate,
				isDeceased: summary.isDeceased,
				matches,
				...(matchedName ? { matchedName } : {})
			});
		}
		return { people: results, hasMore };
	}
}
