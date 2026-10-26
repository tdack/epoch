/**
 * The privacy-leak checks of the data-quality report (Phase 5 item 6, ADR-029). Two rules, both
 * deterministic and explained to the reader, and both about data the tree already holds:
 *
 * - **Always public, but probably living.** A person whose override is `public` and whose facts do
 *   not show they have died or were born before the living cut-off (`isLikelyLiving`, the rule that
 *   would hide them if the override were `auto`).
 * - **Probably dead, but no death recorded.** A person `isLikelyLiving` keeps private, whose
 *   relatives' dates show they cannot be: a parent, partner, partnership, child or grandchild has a
 *   fact that certainly ended long enough before the cut-off (webtrees' `Individual::isDead()`).
 * - **Words that name a private person where viewers can read them.** A note or a source that a
 *   restricted viewer may see (`maskRows`, with the viewer's own creations left out) whose words
 *   contain the full given name and surname of a private person, as a whole phrase, and that
 *   person is not what the note is on. Neither a given name alone nor a surname alone counts: a
 *   first name in a note is not a leak, and a rule that fired on it would be ignored.
 *
 * Run over every row, for a manager or owner only: the finding itself names the private person.
 */

import { cutoffParts, isLikelyLiving, PERSON_PRIVACY, type LivingFact } from './living-state';
import { addYears } from './quality-checks';
import type { IndividualRow, NoteAttachmentRow, TreeRows } from './change-log';
import { maskRows, privatePeople } from './privacy-mask';
import { personName } from './tree-ops';
import { sourceLabel } from '../../shared/evidence';
import {
	findingKey,
	QUALITY_RULE_BY_CODE,
	type FindingSubject,
	type QualityFinding,
	type QualityRuleCode
} from '../../shared/quality';

/**
 * How many years before the living cut-off a relative's fact must have ended for the person to be
 * dead, as webtrees 2.2.6 `Individual::isDead()` has them against MAX_ALIVE_AGE. Negative is after.
 */
const PARENT_FACT_YEARS = 45;
const PARTNER_FACT_YEARS = 40;
const PARTNERSHIP_FACT_YEARS = -10;
const CHILD_FACT_YEARS = -15;
const GRANDCHILD_FACT_YEARS = -30;

/** A name as the words of a note would write it, lower-cased, with runs of space made one. */
const phraseOf = (given: string | null, surname: string | null): string | null => {
	const g = given?.trim().toLowerCase().replace(/\s+/g, ' ');
	const s = surname?.trim().toLowerCase().replace(/\s+/g, ' ');
	return g && s ? `${g} ${s}` : null;
};

/**
 * The words in a text, lower-cased: runs of letters, with an apostrophe or hyphen inside one. A
 * possessive ("Aliveson's") is also given without its ending, so a surname is found in it.
 */
const wordsOf = (text: string): string[] =>
	(text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).flatMap((word) =>
		/['’]s$/.test(word) ? [word, word.slice(0, -2)] : [word]
	);

/** Whether `phrase` occurs in `text` bounded by something that is not a letter or digit on both sides. */
function containsPhrase(text: string, phrase: string): boolean {
	const lower = text.toLowerCase().replace(/\s+/g, ' ');
	let from = 0;
	for (;;) {
		const at = lower.indexOf(phrase, from);
		if (at === -1) return false;
		const before = lower[at - 1];
		const after = lower[at + phrase.length];
		const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
		if (!isWord(before) && !isWord(after)) return true;
		from = at + 1;
	}
}

export function checkPrivacyLeaks(rows: TreeRows, cutoff: string): QualityFinding[] {
	const findings: QualityFinding[] = [];
	const person = (p: IndividualRow): FindingSubject => ({
		kind: 'person',
		id: p.id,
		name: personName(p)
	});
	function add(
		rule: QualityRuleCode,
		keyIds: string[],
		message: string,
		subjects: FindingSubject[]
	) {
		findings.push({
			key: findingKey(rule, ...keyIds),
			rule,
			severity: QUALITY_RULE_BY_CODE.get(rule)!.severity,
			message,
			subjects
		});
	}

	// ---- Always public, but probably living ----
	const factsOf = new Map<string, LivingFact[]>();
	for (const e of rows.events) {
		if (e.entityType !== 'INDIVIDUAL') continue;
		factsOf.set(e.entityId, [
			...(factsOf.get(e.entityId) ?? []),
			{ type: e.type, dateSort: e.dateSort, dateSortEnd: e.dateSortEnd }
		]);
	}
	for (const p of rows.individuals) {
		if (p.privacy === 'public' && isLikelyLiving(factsOf.get(p.id) ?? [], cutoff))
			add(
				'public_override_likely_living',
				[p.id],
				`${personName(p)} is set to always public, but may still be living.`,
				[person(p)]
			);
	}

	// ---- Probably dead, but no death recorded ----
	// The earliest upper bound of each person's and each partnership's facts; an undated or
	// open-ended fact has none, so it never counts, erring toward private as ADR-015 does.
	const earliestEnd = new Map<string, string>();
	for (const e of rows.events) {
		if (!e.dateSortEnd) continue;
		const key = `${e.entityType}:${e.entityId}`;
		const known = earliestEnd.get(key);
		if (!known || e.dateSortEnd < known) earliestEnd.set(key, e.dateSortEnd);
	}
	const parentsOf = new Map<string, string[]>();
	const childrenOf = new Map<string, string[]>();
	for (const l of rows.parentChild) {
		// A disputed link is not taken as descent elsewhere either (subtree membership).
		if (l.status === 'disputed') continue;
		parentsOf.set(l.childId, [...(parentsOf.get(l.childId) ?? []), l.parentId]);
		childrenOf.set(l.parentId, [...(childrenOf.get(l.parentId) ?? []), l.childId]);
	}
	const partnersOfUnion = new Map<string, string[]>();
	for (const u of rows.unionPartners)
		partnersOfUnion.set(u.unionId, [...(partnersOfUnion.get(u.unionId) ?? []), u.personId]);
	const unionsOf = new Map<string, string[]>();
	for (const [unionId, ids] of partnersOfUnion)
		for (const id of ids) unionsOf.set(id, [...(unionsOf.get(id) ?? []), unionId]);
	const { livedBefore } = cutoffParts(cutoff);
	for (const p of rows.individuals) {
		// The public tree's cut-off has nobody living, so `isLikelyLiving` keeps this quiet there.
		if (p.privacy !== PERSON_PRIVACY.AUTO || !isLikelyLiving(factsOf.get(p.id) ?? [], cutoff))
			continue;
		const isOlder = (kind: 'INDIVIDUAL' | 'FAMILY', ids: readonly string[], years: number) =>
			ids.some((id) => {
				const end = earliestEnd.get(`${kind}:${id}`);
				return end !== undefined && end < addYears(livedBefore, -years);
			});
		const children = childrenOf.get(p.id) ?? [];
		const unions = unionsOf.get(p.id) ?? [];
		const partners = unions.flatMap((u) => partnersOfUnion.get(u)!).filter((id) => id !== p.id);
		if (
			isOlder('INDIVIDUAL', parentsOf.get(p.id) ?? [], PARENT_FACT_YEARS) ||
			isOlder('FAMILY', unions, PARTNERSHIP_FACT_YEARS) ||
			isOlder('INDIVIDUAL', partners, PARTNER_FACT_YEARS) ||
			isOlder('INDIVIDUAL', children, CHILD_FACT_YEARS) ||
			isOlder(
				'INDIVIDUAL',
				children.flatMap((c) => childrenOf.get(c) ?? []),
				GRANDCHILD_FACT_YEARS
			)
		)
			add(
				'probably_dead_no_death',
				[p.id],
				`${personName(p)} is probably dead, but no death is recorded.`,
				[person(p)]
			);
	}

	// ---- Words that name a private person ----
	const hidden = privatePeople(rows, cutoff, null);
	if (hidden.size === 0) return findings;
	const people = new Map(rows.individuals.map((p) => [p.id, p]));
	// Each private person under every name they have, indexed by the surname word the phrase ends in.
	const bySurnameWord = new Map<string, Array<{ id: string; phrase: string }>>();
	const addName = (id: string, given: string | null, surname: string | null) => {
		const phrase = phraseOf(given, surname);
		if (!phrase) return;
		const last = wordsOf(phrase).at(-1)!;
		const list = bySurnameWord.get(last) ?? [];
		if (!list.some((n) => n.id === id && n.phrase === phrase)) list.push({ id, phrase });
		bySurnameWord.set(last, list);
	};
	for (const id of hidden) {
		const p = people.get(id);
		if (p) addName(id, p.givenName, p.surname);
	}
	for (const n of rows.personNames)
		if (hidden.has(n.personId)) addName(n.personId, n.givenName, n.surname);

	/** The private people a text names. */
	const named = (text: string | null | undefined): string[] => {
		if (!text) return [];
		const found = new Set<string>();
		for (const word of new Set(wordsOf(text)))
			for (const candidate of bySurnameWord.get(word) ?? [])
				if (containsPhrase(text, candidate.phrase)) found.add(candidate.id);
		return [...found];
	};

	// What a viewer with no say of their own may read: attachments of visible subjects and the notes
	// and sources those make visible.
	const visible = maskRows(rows, cutoff, false, null).rows;
	/** The person a note on a person-owned subject is about, so a note about someone is not a leak of them. */
	const ownersOf = (a: NoteAttachmentRow): Set<string> => {
		switch (a.subjectKind) {
			case 'person':
				return new Set([a.subjectId]);
			case 'name': {
				const n = rows.personNames.find((x) => x.id === a.subjectId);
				return new Set(n ? [n.personId] : []);
			}
			case 'event': {
				const e = rows.events.find((x) => x.id === a.subjectId);
				return new Set(e?.entityType === 'INDIVIDUAL' ? [e.entityId] : []);
			}
			case 'parent_child': {
				const l = rows.parentChild.find((x) => x.id === a.subjectId);
				return new Set(l ? [l.parentId, l.childId] : []);
			}
			default:
				return new Set();
		}
	};
	const nameOfPerson = (id: string) => personName(people.get(id)!);

	const reported = new Set<string>();
	const report = (
		rule: 'note_names_private_person' | 'source_names_private_person',
		recordId: string,
		personId: string,
		message: string
	) => {
		const key = `${rule}|${recordId}|${personId}`;
		if (reported.has(key)) return;
		reported.add(key);
		add(rule, [recordId, personId], message, [person(people.get(personId)!)]);
	};

	for (const a of visible.noteAttachments) {
		if (a.noteId) continue;
		for (const id of named(a.text))
			if (!ownersOf(a).has(id))
				report(
					'note_names_private_person',
					a.id,
					id,
					`A note on a record viewers can see names ${nameOfPerson(id)}, who is private.`
				);
	}
	for (const note of visible.notes) {
		const uses = visible.noteAttachments.filter((a) => a.noteId === note.id);
		for (const id of named(note.text))
			// A shared note is visible because something visible uses it; if the only use is by the
			// person it names, it would not be visible, so any use that survives is somewhere else.
			if (uses.some((a) => !ownersOf(a).has(id)))
				report(
					'note_names_private_person',
					note.id,
					id,
					`A shared note viewers can see names ${nameOfPerson(id)}, who is private.`
				);
	}
	for (const source of visible.sources) {
		const words = [
			source.title,
			source.author,
			source.publication,
			source.abbreviation,
			source.text
		]
			.filter(Boolean)
			.join('\n');
		for (const id of named(words))
			report(
				'source_names_private_person',
				source.id,
				id,
				`The source “${sourceLabel(source)}”, which viewers can see, names ${nameOfPerson(id)}, who is private.`
			);
	}
	return findings;
}
