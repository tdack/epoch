/**
 * What an import would do, computed from the parsed file and the tree's current rows without
 * writing anything. Pure: the repository supplies the rows, so the counts here and the writes it
 * makes share one definition of "the same fact" and "the same record".
 */

import type { ParsedEvent, ParsedGedcomData } from './parser';
import { detectDuplicateFamilies } from './duplicate-families';
import { type DuplicateFamilyReport } from '../../shared/duplicate-families';

export type ImportMode = 'replace' | 'merge';

export interface ImportPreview {
	mode: ImportMode;
	/** replace mode: what gets deleted */
	deleteCounts?: { individuals: number; families: number; events: number; childLinks: number };
	/** merge mode: what changes */
	merge?: {
		newIndividuals: number;
		existingIndividuals: number;
		newFamilies: number;
		mergedFamilies: number; // duplicate families in file that map onto existing ones
		newChildLinks: number;
		duplicateChildLinks: number;
		newEvents: number;
		duplicateEvents: number;
	};
	incoming: { individuals: number; families: number; events: number };
	/** Families the file repeats: exact ones can be merged on import, possible ones are for review. */
	duplicates: DuplicateFamilyReport;
	/**
	 * Structures under events that are kept as written and cannot be edited yet, counted by their
	 * top-level tag. Counts only: the content is never shown here.
	 */
	retainedTags: RetainedTagCount[];
}

interface RetainedTagCount {
	tag: string;
	count: number;
}

/** A report lists at most this many tags, so a file full of custom tags stays readable. */
const MAX_RETAINED_TAGS = 20;

/**
 * The top-level tags of the lines an event keeps verbatim, most frequent first. A kept line's level
 * is one below its event's children only when it is a direct child, which is the only kind the
 * event keeps at level 2; deeper lines belong to it and are not counted again.
 */
function retainedTagsOf(parsed: ParsedGedcomData): RetainedTagCount[] {
	const counts = new Map<string, number>();
	const events = [
		...parsed.individuals.flatMap((i) => i.events),
		...parsed.families.flatMap((f) => f.events)
	];
	for (const ev of events) {
		for (const line of ev.extra ?? []) {
			const tag = /^\s*2\s+(\S+)/.exec(line)?.[1];
			if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return [...counts]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
		.slice(0, MAX_RETAINED_TAGS);
}

export interface ImportOptions {
	/**
	 * Fold exact duplicate families into one, keeping every XREF as an alias. Off unless asked, so
	 * a caller that does not know about duplicates gets the file exactly as written.
	 */
	shouldMergeDuplicateFamilies?: boolean;
}

/** The part of a stored fact that decides whether an incoming one repeats it. */
export interface EventKeyInput {
	entityType: string;
	entityId: string;
	type: string;
	dateRaw?: string | null;
	place?: string | null;
	description?: string | null;
	value?: string | null;
	cause?: string | null;
	age?: string | null;
	notes?: string | null;
	gedcomExtra?: string[] | null;
	address?: string | null;
	classification?: string | null;
	agency?: string | null;
	phone?: string | null;
	email?: string | null;
	fax?: string | null;
	web?: string | null;
	latitude?: string | null;
	longitude?: string | null;
	placeExtra?: string[] | null;
	religion?: string | null;
}

/**
 * The key input a parsed fact is compared by. The parsed field for the kept lines is `extra`, but the
 * key reads the stored column `gedcomExtra`: spreading the parsed event in would leave the kept lines
 * out of the preview's key, so it would call a fact a repeat that the import keeps apart.
 */
function eventKeyOfParsed(
	entityType: EventKeyInput['entityType'],
	entityId: string,
	ev: ParsedEvent
): EventKeyInput {
	return {
		entityType,
		entityId,
		type: ev.type,
		dateRaw: ev.dateRaw,
		place: ev.place,
		description: ev.description,
		value: ev.value,
		cause: ev.cause,
		age: ev.age,
		notes: ev.notes,
		gedcomExtra: ev.extra,
		address: ev.address,
		classification: ev.classification,
		agency: ev.agency,
		phone: ev.phone,
		email: ev.email,
		fax: ev.fax,
		web: ev.web,
		latitude: ev.latitude,
		longitude: ev.longitude,
		placeExtra: ev.placeExtra,
		religion: ev.religion
	};
}

/** What the tree already holds, as much of it as the comparison needs. */
export interface PreviewRows {
	individuals: Array<{ id: string; xrefId: string | null }>;
	unions: Array<{ id: string }>;
	parentChild: Array<{ unionId: string | null; childId: string }>;
	events: EventKeyInput[];
}

/**
 * The identity of an event for merge-mode de-duplication, shared by the preview and the import so
 * their counts agree. The value, cause, age and note are part of it: two undated occupations with
 * different values are two facts, not one repeated. The address layout is not: it records only how the
 * file split the same address across lines, so the same address written with CONC or CONT is one fact.
 */
export function eventContentKey(e: EventKeyInput): string {
	// The kept lines are part of it: the same fact with a different citation is a different record.
	return [
		e.entityType,
		e.entityId,
		e.type,
		e.dateRaw,
		e.place,
		e.description,
		e.value,
		e.cause,
		e.age,
		e.notes,
		(e.gedcomExtra ?? []).join('\n'),
		e.address,
		e.classification,
		e.agency,
		e.phone,
		e.email,
		e.fax,
		e.web,
		e.latitude,
		e.longitude,
		// JSON, so a line break inside one line cannot read as two.
		e.placeExtra?.length ? JSON.stringify(e.placeExtra) : '',
		e.religion
	]
		.map((part) => part ?? '')
		.join('\u0000');
}

/** An id as stored: the file's XREF, prefixed with the tree it belongs to unless it already is. */
export function treeScopedId(treeId: string, rawXrefOrId: string): string {
	if (rawXrefOrId.startsWith(`${treeId}:`)) return rawXrefOrId;
	return `${treeId}:${rawXrefOrId}`;
}

function countIncoming(parsed: ParsedGedcomData): ImportPreview['incoming'] {
	return {
		individuals: parsed.individuals.length,
		families: parsed.families.length,
		events:
			parsed.individuals.reduce((n, i) => n + i.events.length, 0) +
			parsed.families.reduce((n, f) => n + f.events.length, 0)
	};
}

/** Preview for a file with no tree to compare against: a new tree, so only the file is analysed. */
export function previewNewTree(fresh: ParsedGedcomData): ImportPreview {
	return {
		mode: 'replace',
		incoming: countIncoming(fresh),
		duplicates: detectDuplicateFamilies(fresh),
		retainedTags: retainedTagsOf(fresh)
	};
}

/**
 * Preview against an existing tree. `parsed` is the file after folding any family that an earlier
 * import merged into another, so the counts match what the import will do; `fresh` is the file as
 * written, which is what the duplicate report describes.
 */
export function previewAgainstTree(
	treeId: string,
	fresh: ParsedGedcomData,
	parsed: ParsedGedcomData,
	rows: PreviewRows
): ImportPreview {
	const incoming = countIncoming(fresh);
	const duplicates = detectDuplicateFamilies(fresh);
	const retainedTags = retainedTagsOf(fresh);

	const deleteCounts = {
		individuals: rows.individuals.length,
		families: rows.unions.length,
		events: rows.events.length,
		childLinks: rows.parentChild.length
	};

	// Merge analysis — identity is the tree-scoped GEDCOM XREF, never a spouse
	// pair. A family that collides with an existing XREF maps onto that record;
	// a distinct XREF always stays distinct, even if the participants match.
	const existingEventKeys = new Set(rows.events.map(eventContentKey));
	const existingChildKeys = new Set(rows.parentChild.map((c) => `${c.unionId}:${c.childId}`));
	const existingIndIds = new Set(rows.individuals.map((i) => i.id));
	const existingIndXrefs = new Set(rows.individuals.map((i) => i.xrefId || i.id));
	const existingFamIds = new Set(rows.unions.map((f) => f.id));

	const merge: NonNullable<ImportPreview['merge']> = {
		newIndividuals: 0,
		existingIndividuals: 0,
		newFamilies: 0,
		mergedFamilies: 0,
		newChildLinks: 0,
		duplicateChildLinks: 0,
		newEvents: 0,
		duplicateEvents: 0
	};

	for (const fam of parsed.families) {
		const targetFamId = treeScopedId(treeId, fam.id);
		if (existingFamIds.has(targetFamId)) {
			merge.mergedFamilies++;
		} else {
			merge.newFamilies++;
		}
		for (const ch of fam.children) {
			const targetChildId = treeScopedId(treeId, ch.childId);
			if (existingChildKeys.has(`${targetFamId}:${targetChildId}`)) {
				merge.duplicateChildLinks++;
			} else {
				merge.newChildLinks++;
				existingChildKeys.add(`${targetFamId}:${targetChildId}`);
			}
		}
		for (const ev of fam.events) {
			const evKey = eventContentKey(eventKeyOfParsed('FAMILY', targetFamId, ev));
			if (existingEventKeys.has(evKey)) {
				merge.duplicateEvents++;
			} else {
				merge.newEvents++;
				existingEventKeys.add(evKey);
			}
		}
	}

	for (const ind of parsed.individuals) {
		const scopedIndId = treeScopedId(treeId, ind.id);
		if (existingIndIds.has(scopedIndId) || existingIndXrefs.has(ind.id)) {
			merge.existingIndividuals++;
		} else {
			merge.newIndividuals++;
		}
		for (const ev of ind.events) {
			const evKey = eventContentKey(eventKeyOfParsed('INDIVIDUAL', scopedIndId, ev));
			if (existingEventKeys.has(evKey)) {
				merge.duplicateEvents++;
			} else {
				merge.newEvents++;
				existingEventKeys.add(evKey);
			}
		}
	}

	return { mode: 'merge', deleteCounts, merge, incoming, duplicates, retainedTags };
}
