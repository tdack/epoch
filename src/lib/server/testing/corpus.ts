/**
 * A large, deterministic family tree for tests that a small fixture cannot make: thousands of
 * people across nine generations, so a view of a few generations is a small part of the whole and
 * a query that reads the tree instead of the neighbourhood shows up in a row count.
 *
 * It deliberately includes the shapes the layout treats specially: second partnerships, an
 * adopted child, a single parent with no partnership, and cousins who marry (pedigree collapse).
 * Not imported by app code.
 */

import type { BatchItem } from 'drizzle-orm/batch';
import type { DbClient } from '../db';
import { events, individuals, parentChild, personNames, unionPartners, unions } from '../db/schema';
import { dateColumnsFor } from '../domain/date-columns';
import { pointFactsAtPlaces } from '../repositories/place-repository';

export interface CorpusOptions {
	/** Scopes every id, so several corpora can share one test database. */
	prefix: string;
	seed?: number;
	/** Founding couples in the first generation; each grows into its own lineage. */
	lineages?: number;
	generations?: number;
	/**
	 * Give people the things a search needs: varied names, stored name rows (preferred, married,
	 * nicknames), XREFs and birth places. Off by default so the structural corpus, and every test
	 * that compares layouts over it, stays exactly as it was. Drawn from a second random stream, so
	 * turning it on never changes who is related to whom.
	 */
	shouldNameThePeople?: boolean;
}

const GIVEN_NAMES = ['Ann', 'Bede', 'Clara', 'Dougal', 'Edith', 'Fergus', 'Grace', 'Hugh', 'Isla', 'Jonas', 'Kitty', 'Leo', 'Maud', 'Nora', 'Owen', 'Petra', 'Quentin', 'Rose', 'Silas', 'Thea', 'Una', 'Victor', 'Wilma', 'Xavier', 'Yvette', 'Zachary'];
const SURNAME_STEMS = ['Ash', 'Brown', 'Cole', 'Dunn', 'Ellis', 'Finch', 'Gray', 'Hale', 'Ives', 'Judd', 'Kerr', 'Lane', 'Marsh', 'Nash', 'Orr', 'Platt', 'Quill', 'Reeve', 'Shaw', 'Tate', 'Vane', 'Webb', 'Yates'];
const SURNAME_ENDS = ['', 'ton', 'by', 'ford', 'man'];
const PLACES = ['Hobart, Tasmania', 'Launceston, Tasmania', 'Sydney, New South Wales', 'Melbourne, Victoria', 'Cork, Ireland', 'Leeds, Yorkshire, England', 'Truro, Cornwall, England', 'Aberdeen, Scotland', 'Cardiff, Wales', 'Hamburg, Germany'];

export interface CorpusSummary {
	people: number;
	unions: number;
	links: number;
	events: number;
	/** The founders of the first lineage, and a person in the last generation: two ends to focus. */
	rootPersonId: string;
	leafPersonId: string;
	/** A person in the middle generation with two partnerships and children in each. */
	remarriedPersonId: string;
}

/** Mulberry32: tiny, seedable and stable across Node versions. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface Person {
	id: string;
	sex: 'M' | 'F';
	lineage: number;
	generation: number;
	parentUnionId: string | null;
}

export async function insertCorpus(db: DbClient, treeId: string, options: CorpusOptions): Promise<CorpusSummary> {
	const { prefix, seed = 20260930, lineages = 8, generations = 9 } = options;
	const rand = random(seed);
	const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!;

	const people: Person[] = [];
	const unionRows: Array<{ id: string; status: 'active' | 'divorced'; partners: string[]; year: number }> = [];
	const links: Array<{ id: string; parentId: string; childId: string; type: 'biological' | 'adoptive'; unionId: string | null }> = [];
	const personEvents: Array<{ personId: string; type: 'BIRT' | 'DEAT'; year: number }> = [];
	let remarriedPersonId = '';

	const newPerson = (generation: number, lineage: number, parentUnionId: string | null): Person => {
		const person: Person = {
			id: `${prefix}-p${people.length}`,
			sex: rand() < 0.5 ? 'M' : 'F',
			lineage,
			generation,
			parentUnionId
		};
		people.push(person);
		const birthYear = 1700 + generation * 25 + Math.floor(rand() * 10);
		personEvents.push({ personId: person.id, type: 'BIRT', year: birthYear });
		if (rand() < 0.3) personEvents.push({ personId: person.id, type: 'DEAT', year: birthYear + 40 + Math.floor(rand() * 40) });
		return person;
	};
	const newUnion = (partnerIds: string[], generation: number, status: 'active' | 'divorced' = 'active') => {
		const id = `${prefix}-u${unionRows.length}`;
		unionRows.push({ id, status, partners: partnerIds, year: 1700 + generation * 25 + 20 });
		return id;
	};
	const addChildren = (unionId: string, parentIds: string[], count: number, generation: number, lineage: number) => {
		const children: Person[] = [];
		for (let i = 0; i < count; i++) {
			const child = newPerson(generation, lineage, unionId);
			const isAdopted = rand() < 0.04;
			parentIds.forEach((parentId, index) =>
				links.push({
					id: `${prefix}-l${links.length}`,
					parentId,
					childId: child.id,
					// One parent of an adopted child stays biological, so the two links differ.
					type: isAdopted && index === 1 ? 'adoptive' : 'biological',
					unionId
				})
			);
			children.push(child);
		}
		return children;
	};

	// Generation 0: one founding couple per lineage.
	let current: Array<{ unionId: string; partnerIds: string[]; lineage: number }> = [];
	for (let lineage = 0; lineage < lineages; lineage++) {
		const a = newPerson(0, lineage, null);
		const b = newPerson(0, lineage, null);
		current.push({ unionId: newUnion([a.id, b.id], 0), partnerIds: [a.id, b.id], lineage });
	}

	for (let generation = 1; generation < generations; generation++) {
		const grown: Person[] = [];
		for (const couple of current) {
			// About two children a couple keeps the population doubling each generation.
			const count = pick([0, 1, 1, 2, 2, 2, 3, 3, 4]);
			grown.push(...addChildren(couple.unionId, couple.partnerIds, count, generation, couple.lineage));
		}

		// A single parent with a child and no partnership at all.
		if (grown.length > 20) {
			const parent = grown[Math.floor(rand() * grown.length)]!;
			const child = newPerson(generation + 1 < generations ? generation + 1 : generation, parent.lineage, null);
			links.push({ id: `${prefix}-l${links.length}`, parentId: parent.id, childId: child.id, type: 'biological', unionId: null });
		}

		const next: typeof current = [];
		const unpaired = [...grown];
		while (unpaired.length > 0) {
			const person = unpaired.shift()!;
			if (rand() > 0.9) continue; // never partnered
			// Cousins who marry: same lineage, different parents. Rare, but it makes a shared ancestor.
			let partner: Person | undefined;
			if (rand() < 0.03) {
				const cousinIndex = unpaired.findIndex((c) => c.lineage === person.lineage && c.parentUnionId !== person.parentUnionId);
				if (cousinIndex >= 0) partner = unpaired.splice(cousinIndex, 1)[0];
			}
			const partnerIds = [person.id, (partner ?? newPerson(generation, person.lineage, null)).id];
			const unionId = newUnion(partnerIds, generation, rand() < 0.1 ? 'divorced' : 'active');
			next.push({ unionId, partnerIds, lineage: person.lineage });

			// A second partnership, each with its own children, for one in eight.
			if (rand() < 0.125 && generation < generations - 1) {
				const second = newPerson(generation, person.lineage, null);
				const secondUnion = newUnion([person.id, second.id], generation);
				next.push({ unionId: secondUnion, partnerIds: [person.id, second.id], lineage: person.lineage });
				if (!remarriedPersonId && generation === Math.floor(generations / 2)) remarriedPersonId = person.id;
			}
		}
		current = next;
	}

	// ---- Write ----
	// Rows per statement keep the bound parameters under D1's 100 for each table's width, and the
	// statements go in batches so seeding thousands of rows is not thousands of round trips.
	const pending: Array<BatchItem<'sqlite'>> = [];
	const insertAll = async <T>(rows: T[], perStatement: number, write: (chunk: T[]) => BatchItem<'sqlite'>) => {
		for (let i = 0; i < rows.length; i += perStatement) pending.push(write(rows.slice(i, i + perStatement)));
	};

	// A second stream for everything the search adds, so the first stream (the tree's shape) is
	// identical whether or not names are on.
	const nameRand = random(seed ^ 0x9e3779b9);
	const nameOf = new Map<string, { given: string; surname: string }>();
	for (const p of people) {
		nameOf.set(p.id, options.shouldNameThePeople
			? {
					given: GIVEN_NAMES[Math.floor(nameRand() * GIVEN_NAMES.length)]!,
					// A lineage keeps a handful of surnames, so the surname list has real counts to show.
					surname: SURNAME_STEMS[(p.lineage * 3 + Math.floor(nameRand() * 3)) % SURNAME_STEMS.length]! + SURNAME_ENDS[Math.floor(nameRand() * SURNAME_ENDS.length)]!
				}
			: { given: `Given${p.id.split('-p')[1]}`, surname: `Line${p.lineage}` });
	}
	insertAll(people, 9, (chunk) =>
		db.insert(individuals).values(
			chunk.map((p) => ({
				id: p.id,
				treeId,
				givenName: nameOf.get(p.id)!.given,
				surname: nameOf.get(p.id)!.surname,
				sex: p.sex,
				createdAt: new Date(0),
				updatedAt: new Date(0),
				xrefId: options.shouldNameThePeople ? `@I${p.id.split('-p')[1]}@` : null,
				version: 1
			}))
		)
	);
	if (options.shouldNameThePeople) {
		const nameRows: Array<typeof personNames.$inferInsert> = [];
		for (const p of people) {
			const { given, surname } = nameOf.get(p.id)!;
			const base = { personId: p.id, createdAt: new Date(0), updatedAt: new Date(0), version: 1 };
			nameRows.push({ ...base, id: `${p.id}-n0`, type: 'birth', givenName: given, surname, isPreferred: true, order: 0 });
			// Women take a married name in a fifth of cases: the person is found by either.
			if (p.sex === 'F' && nameRand() < 0.2) {
				nameRows.push({ ...base, id: `${p.id}-n1`, type: 'married', givenName: given, surname: SURNAME_STEMS[Math.floor(nameRand() * SURNAME_STEMS.length)] + 'son', isPreferred: false, order: 1 });
			}
			if (nameRand() < 0.05) {
				nameRows.push({ ...base, id: `${p.id}-n2`, type: 'aka', givenName: given, surname, nickname: `Nick${p.id.split('-p')[1]}`, isPreferred: false, order: 2 });
			}
		}
		insertAll(nameRows, 6, (chunk) => db.insert(personNames).values(chunk));
	}
	insertAll(unionRows, 6, (chunk) =>
		db.insert(unions).values(chunk.map((u) => ({ id: u.id, treeId, status: u.status, createdAt: new Date(0), updatedAt: new Date(0) })))
	);
	const partnerRows = unionRows.flatMap((u) =>
		u.partners.map((personId, order) => ({ id: `${u.id}-p${order}`, unionId: u.id, personId, order, createdAt: new Date(0) }))
	);
	insertAll(partnerRows, 15, (chunk) => db.insert(unionPartners).values(chunk));
	insertAll(links, 7, (chunk) =>
		db.insert(parentChild).values(
			chunk.map((l) => ({ ...l, treeId, status: 'active' as const, gedcomPedi: null, createdAt: new Date(0), updatedAt: new Date(0) }))
		)
	);

	const eventRows = [
		...personEvents.map((e, i) => ({
			id: `${prefix}-e${i}`,
			entityType: 'INDIVIDUAL' as const,
			entityId: e.personId,
			type: e.type,
			dateRaw: String(e.year),
			place: options.shouldNameThePeople && e.type === 'BIRT' ? PLACES[Math.floor(nameRand() * PLACES.length)]! : null
		})),
		...unionRows.map((u, i) => ({
			id: `${prefix}-m${i}`,
			entityType: 'FAMILY' as const,
			entityId: u.id,
			type: 'MARR',
			dateRaw: String(u.year),
			place: options.shouldNameThePeople ? PLACES[Math.floor(nameRand() * PLACES.length)]! : null
		}))
	];
	insertAll(eventRows, 4, (chunk) =>
		db.insert(events).values(
			chunk.map((e) => ({ ...e, treeId, ...dateColumnsFor(e.dateRaw), description: null, createdAt: new Date(0), updatedAt: new Date(0) }))
		)
	);

	pending.push(...pointFactsAtPlaces(db, treeId));

	for (let i = 0; i < pending.length; i += 50) {
		await db.batch(pending.slice(i, i + 50) as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
	}

	return {
		people: people.length,
		unions: unionRows.length,
		links: links.length,
		events: eventRows.length,
		rootPersonId: people[0]!.id,
		leafPersonId: people.at(-1)!.id,
		remarriedPersonId: remarriedPersonId || people[Math.floor(people.length / 2)]!.id
	};
}
