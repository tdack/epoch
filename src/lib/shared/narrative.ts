/**
 * A person's record told as sentences, for the ancestor and descendant narratives (reports plan,
 * stage 6). Written for the neutral model: a partnership is "married" only when a marriage is
 * recorded, a child's adoptive, foster or guardian link is said as such, and nobody's sex is used
 * to choose a pronoun, so a later sentence says the person's given name.
 *
 * Pure: the service hands in what the viewer may see, already masked, and the tree's date format.
 */

import { ageAt } from './age';
import { DATE_PRECISIONS, DATE_QUALIFIERS, parseDateValue } from './date-value';
import { displayDate, type DateFormat } from './date-display';
import { PARENT_CHILD_TYPES, type ParentChildType } from './relationship-model';

/** What one citation adds to the endnotes: `key` is what makes two citations the same note. */
export interface NoteRef {
	key: string;
	text: string;
}

export interface NarrativeFact {
	type: string;
	/** The fact's own label, for a type with no sentence of its own ("Military service"). */
	label: string;
	dateText: string | null;
	place: string | null;
	value: string | null;
	notes: NoteRef[];
}

export interface NarrativeChild {
	name: string;
	/** Their number in this report, when they have an entry of their own. */
	number: string | null;
	/** How the subject is this child's parent. */
	type: ParentChildType;
}

interface NarrativePartnership {
	/** Null when no partner is recorded. */
	partnerName: string | null;
	events: NarrativeFact[];
	children: NarrativeChild[];
}

export interface NarrativePerson {
	name: string;
	givenName: string;
	parents: Array<{ name: string; type: ParentChildType }>;
	facts: NarrativeFact[];
	partnerships: NarrativePartnership[];
	/** Children whose link to the subject sits in no partnership. */
	otherChildren: NarrativeChild[];
}

/** One sentence and the endnote numbers that support it. */
export interface NarrativeSentence {
	text: string;
	notes: number[];
}

/** Numbered endnotes shared by a whole report: the same citation is one note however often it is used. */
export class Endnotes {
	private numbers = new Map<string, number>();
	private texts: string[] = [];

	cite(refs: readonly NoteRef[]): number[] {
		const numbers = refs.map((ref) => {
			let number = this.numbers.get(ref.key);
			if (number === undefined) {
				this.texts.push(ref.text);
				number = this.texts.length;
				this.numbers.set(ref.key, number);
			}
			return number;
		});
		return [...new Set(numbers)].sort((a, b) => a - b);
	}

	list(): Array<{ number: number; text: string }> {
		return this.texts.map((text, index) => ({ number: index + 1, text }));
	}
}

/** "on 3 March 1900", "in 1900", "about 1900": a date ready to follow a verb; empty for none. */
export function dateClause(raw: string | null, format: DateFormat): string {
	if (!raw?.trim()) return '';
	const value = parseDateValue(raw);
	const words = displayDate(raw, format);
	if (value.qualifier === DATE_QUALIFIERS.PHRASE || value.qualifier === DATE_QUALIFIERS.UNKNOWN)
		return `on a date given as “${words}”`;
	if (value.qualifier !== DATE_QUALIFIERS.EXACT) return words;
	return value.precision === DATE_PRECISIONS.DAY ? `on ${words}` : `in ${words}`;
}

const join = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' ');

/** "A", "A and B", "A, B and C". */
export function listOf(items: readonly string[]): string {
	if (items.length <= 1) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const when = (fact: NarrativeFact, format: DateFormat, preposition = 'in') =>
	join(dateClause(fact.dateText, format), fact.place ? `${preposition} ${fact.place}` : null);

const PARENT_WORDS: Record<ParentChildType, string> = {
	[PARENT_CHILD_TYPES.BIOLOGICAL]: 'child of',
	[PARENT_CHILD_TYPES.UNKNOWN]: 'child of',
	[PARENT_CHILD_TYPES.ADOPTIVE]: 'adopted child of',
	[PARENT_CHILD_TYPES.FOSTER]: 'foster child of',
	[PARENT_CHILD_TYPES.GUARDIAN]: 'ward of'
};

const CHILD_WORDS: Partial<Record<ParentChildType, string>> = {
	[PARENT_CHILD_TYPES.ADOPTIVE]: 'adopted',
	[PARENT_CHILD_TYPES.FOSTER]: 'foster child',
	[PARENT_CHILD_TYPES.GUARDIAN]: 'ward'
};

/** ", child of A and B, and adopted child of C," or empty. */
function parentsClause(parents: NarrativePerson['parents']): string {
	const groups = new Map<string, string[]>();
	for (const parent of parents) {
		const words = PARENT_WORDS[parent.type];
		groups.set(words, [...(groups.get(words) ?? []), parent.name]);
	}
	const clauses = [...groups].map(([words, names]) => `${words} ${listOf(names)}`);
	return clauses.length === 0 ? '' : `, ${listOf(clauses)},`;
}

function childName(child: NarrativeChild): string {
	const marks = [child.number, CHILD_WORDS[child.type]].filter(Boolean);
	return marks.length > 0 ? `${child.name} (${marks.join(', ')})` : child.name;
}

/** Facts a person has a sentence for, as verb phrases after their given name. */
const PERSON_VERBS: Record<string, (fact: NarrativeFact, format: DateFormat) => string> = {
	BIRT: (f, d) => join('was born', when(f, d)),
	CHR: (f, d) => join('was christened', when(f, d)),
	BAPM: (f, d) => join('was baptised', when(f, d)),
	DEAT: (f, d) => join('died', when(f, d)),
	BURI: (f, d) => join('was buried', when(f, d)),
	CREM: (f, d) => join('was cremated', when(f, d)),
	EMIG: (f, d) => join('emigrated', dateClause(f.dateText, d), f.place ? `from ${f.place}` : null),
	IMMI: (f, d) => join('immigrated', dateClause(f.dateText, d), f.place ? `to ${f.place}` : null),
	NATU: (f, d) => join('was naturalised', when(f, d)),
	CENS: (f, d) => join('was recorded in a census', when(f, d)),
	RESI: (f, d) =>
		join(
			'lived',
			f.place ? `in ${f.place}` : f.value ? `at ${f.value}` : null,
			dateClause(f.dateText, d)
		),
	OCCU: (f, d) => join(`worked as ${f.value ?? 'something not recorded'}`, when(f, d))
};

/** A partnership's own events, as sentences about the couple. */
const UNION_SENTENCES: Record<string, (fact: NarrativeFact, format: DateFormat) => string> = {
	ENGA: (f, d) => join('They were engaged', when(f, d)),
	MARB: (f, d) => join('Their banns were read', when(f, d)),
	MARC: (f, d) => join('They made a marriage contract', when(f, d)),
	MARL: (f, d) => join('They took out a marriage licence', when(f, d)),
	MARS: (f, d) => join('They made a marriage settlement', when(f, d)),
	_SEPR: (f, d) => join('They separated', when(f, d)),
	DIVF: (f, d) => join('A divorce was filed', when(f, d)),
	DIV: (f, d) => join('They divorced', when(f, d)),
	ANUL: (f, d) => join('Their marriage was annulled', when(f, d))
};

function genericSentence(subject: string, fact: NarrativeFact, format: DateFormat): string {
	const detail = [fact.value, displayDate(fact.dateText, format), fact.place].filter(Boolean);
	return `${subject ? `${subject}: ` : ''}${fact.label}${detail.length > 0 ? `, ${detail.join(', ')}` : ''}.`;
}

/**
 * The sentences about one person, in the order the facts are given (the caller passes them in
 * date order). Their citations become notes in `endnotes`, numbered across the whole report.
 */
export function narrativeOf(
	person: NarrativePerson,
	format: DateFormat,
	endnotes: Endnotes
): NarrativeSentence[] {
	const sentences: NarrativeSentence[] = [];
	const say = (text: string, facts: readonly NarrativeFact[] = []) =>
		sentences.push({ text, notes: endnotes.cite(facts.flatMap((f) => f.notes)) });

	const birth = person.facts.find((f) => f.type === 'BIRT');
	const opening = birth ?? person.facts.find((f) => f.type === 'CHR' || f.type === 'BAPM');
	const intro = `${person.name}${parentsClause(person.parents)}`;
	if (opening) say(`${intro} ${PERSON_VERBS[opening.type]!(opening, format)}.`, [opening]);
	else say(`${intro.replace(/,$/, '')}.`);

	for (const fact of person.facts) {
		if (fact === opening) continue;
		const verb = PERSON_VERBS[fact.type];
		if (!verb) {
			say(genericSentence(person.givenName, fact, format), [fact]);
			continue;
		}
		const age =
			fact.type === 'DEAT' && birth
				? ageAt(parseDateValue(birth.dateText), parseDateValue(fact.dateText))
				: null;
		// A second birth is a conflicting record, not a second event.
		const lead = fact.type === 'BIRT' ? 'Another record says' : '';
		say(`${join(lead, person.givenName, verb(fact, format))}${age ? `, ${age}` : ''}.`, [fact]);
	}

	for (const partnership of person.partnerships) {
		const marriage = partnership.events.find((e) => e.type === 'MARR');
		const partner = partnership.partnerName;
		if (marriage)
			say(
				`${join(person.givenName, 'married', partner ?? 'a partner whose name is not recorded', when(marriage, format))}.`,
				[marriage]
			);
		else if (partner) say(`${person.givenName} had a partnership with ${partner}.`);
		for (const event of partnership.events) {
			if (event === marriage) continue;
			const sentence = UNION_SENTENCES[event.type];
			say(sentence ? `${sentence(event, format)}.` : genericSentence('', event, format), [event]);
		}
		const children = partnership.children.map(childName);
		const whose = partner ? 'Their' : `${person.givenName}’s`;
		if (children.length === 1) say(`${whose} child was ${children[0]}.`);
		else if (children.length > 1) say(`${whose} children were ${listOf(children)}.`);
	}

	if (person.otherChildren.length > 0)
		say(
			`${person.givenName} also had ${person.otherChildren.length === 1 ? 'a child' : 'children'} with no other parent recorded: ${listOf(person.otherChildren.map(childName))}.`
		);
	return sentences;
}
