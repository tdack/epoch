/**
 * Duplicate `FAM` records in a parsed GEDCOM, found before anything is written.
 *
 * Dirty files carry one family several times. The rules are deliberately narrow, because merging
 * two records that were really two families destroys a fact: only a two-partner family that
 * repeats, with identical facts and no disagreement about a child, is called an exact duplicate
 * and merged automatically. Everything else that looks alike is only reported.
 */

import { factKey, partnerSetKey } from '../../shared/union-merge';
import type { ParsedEvent, ParsedFamily, ParsedGedcomData } from './index';

export const POSSIBLE_DUPLICATE_REASONS = {
	DIFFERENT_FACTS: 'different_facts',
	DIFFERENT_CHILD_RECORDS: 'different_child_records',
	SUBSET_OF_FULL_FAMILY: 'subset_of_full_family',
	SAME_SINGLE_PARTNER: 'same_single_partner'
} as const;
export type PossibleDuplicateReason = (typeof POSSIBLE_DUPLICATE_REASONS)[keyof typeof POSSIBLE_DUPLICATE_REASONS];

export interface ExactDuplicateGroup {
	/** The family that stays, then the ones merged into it. */
	familyIds: string[];
	survivorId: string;
	partners: string[];
	/** Distinct children once merged. */
	childCount: number;
}

export interface PossibleDuplicateGroup {
	familyIds: string[];
	reason: PossibleDuplicateReason;
	partners: string[];
}

export interface DuplicateFamilyReport {
	exact: ExactDuplicateGroup[];
	possible: PossibleDuplicateGroup[];
}

const partnersOf = (fam: ParsedFamily) => [fam.husbandId, fam.wifeId].filter((id): id is string => Boolean(id));

const factsOf = (events: ParsedEvent[]) =>
	events.map((e) => factKey({ type: e.type, dateText: e.dateRaw ?? null, place: e.place ?? null, description: e.description ?? null }));

const signatureOf = (fam: ParsedFamily) => factsOf(fam.events).sort().join('\n');

const pedigreeKey = (child: ParsedFamily['children'][number]) =>
	JSON.stringify([child.pedigree ?? 'birth', child.parentPedigrees ?? null]);

/** Two families disagree about a child when both list them with a different pedigree. */
function hasChildConflict(families: ParsedFamily[]): boolean {
	const seen = new Map<string, string>();
	for (const fam of families) {
		for (const child of fam.children) {
			const key = pedigreeKey(child);
			if (seen.has(child.childId) && seen.get(child.childId) !== key) return true;
			seen.set(child.childId, key);
		}
	}
	return false;
}

/** Most children first, then file order: the fullest record keeps its XREF as the primary one. */
function survivorOf(cluster: ParsedFamily[]): ParsedFamily {
	return cluster.reduce((best, fam) => (fam.children.length > best.children.length ? fam : best));
}

interface Analysis {
	report: DuplicateFamilyReport;
	/** Clusters to merge, as families in file order. */
	clusters: ParsedFamily[][];
}

function analyse(parsed: ParsedGedcomData): Analysis {
	const nameOf = (id: string) => {
		const person = parsed.individuals.find((p) => p.id === id);
		return [person?.givenName, person?.surname].filter(Boolean).join(' ') || id;
	};
	const partnerNames = (fam: ParsedFamily) => partnersOf(fam).map(nameOf);

	const exact: ExactDuplicateGroup[] = [];
	const possible: PossibleDuplicateGroup[] = [];
	const clusters: ParsedFamily[][] = [];

	const byPartners = new Map<string, ParsedFamily[]>();
	for (const fam of parsed.families) {
		const partners = partnersOf(fam);
		if (partners.length === 0) continue;
		const key = partnerSetKey(partners);
		byPartners.set(key, [...(byPartners.get(key) ?? []), fam]);
	}

	for (const group of byPartners.values()) {
		if (group.length < 2) continue;
		const partners = partnersOf(group[0]);

		// One partner is not enough to say two records are one family: they may be different, unrecorded,
		// other parents. Report them; never merge them on their own.
		if (partners.length < 2) {
			possible.push({ familyIds: group.map((f) => f.id), reason: POSSIBLE_DUPLICATE_REASONS.SAME_SINGLE_PARTNER, partners: partnerNames(group[0]) });
			continue;
		}

		const bySignature = new Map<string, ParsedFamily[]>();
		for (const fam of group) bySignature.set(signatureOf(fam), [...(bySignature.get(signatureOf(fam)) ?? []), fam]);

		const representatives: ParsedFamily[] = [];
		for (const cluster of bySignature.values()) {
			if (cluster.length < 2) {
				representatives.push(cluster[0]);
				continue;
			}
			if (hasChildConflict(cluster)) {
				possible.push({ familyIds: cluster.map((f) => f.id), reason: POSSIBLE_DUPLICATE_REASONS.DIFFERENT_CHILD_RECORDS, partners: partnerNames(cluster[0]) });
				representatives.push(cluster[0]);
				continue;
			}
			const survivor = survivorOf(cluster);
			exact.push({
				familyIds: [survivor.id, ...cluster.filter((f) => f !== survivor).map((f) => f.id)],
				survivorId: survivor.id,
				partners: partnerNames(survivor),
				childCount: new Set(cluster.flatMap((f) => f.children.map((c) => c.childId))).size
			});
			clusters.push(cluster);
			representatives.push(survivor);
		}
		// Same people, but the records state different facts (or one states a fact the other lacks).
		if (bySignature.size > 1) {
			possible.push({ familyIds: representatives.map((f) => f.id), reason: POSSIBLE_DUPLICATE_REASONS.DIFFERENT_FACTS, partners: partnerNames(group[0]) });
		}
	}

	// A one-partner family inside a fuller family of the same person is probably a stray copy of it.
	for (const fam of parsed.families) {
		const partners = partnersOf(fam);
		if (partners.length !== 1) continue;
		const children = new Set(fam.children.map((c) => c.childId));
		const fuller = parsed.families.filter(
			(other) =>
				partnersOf(other).length > 1 &&
				partnersOf(other).includes(partners[0]) &&
				[...children].every((id) => other.children.some((c) => c.childId === id))
		);
		if (fuller.length > 0) {
			possible.push({ familyIds: [fam.id, ...fuller.map((f) => f.id)], reason: POSSIBLE_DUPLICATE_REASONS.SUBSET_OF_FULL_FAMILY, partners: partnerNames(fam) });
		}
	}

	return { report: { exact, possible }, clusters };
}

export function detectDuplicateFamilies(parsed: ParsedGedcomData): DuplicateFamilyReport {
	return analyse(parsed).report;
}

/**
 * The parsed data with every exact duplicate folded into its survivor: children and events are
 * combined without repeats, and each merged XREF becomes an alias of the survivor.
 */
export function mergeExactDuplicateFamilies(parsed: ParsedGedcomData): { parsed: ParsedGedcomData; mergedCount: number } {
	const { clusters } = analyse(parsed);
	if (clusters.length === 0) return { parsed, mergedCount: 0 };

	const removed = new Set<string>();
	const replacement = new Map<string, ParsedFamily>();
	for (const cluster of clusters) {
		const survivor = survivorOf(cluster);
		const children = new Map<string, ParsedFamily['children'][number]>();
		const events = new Map<string, ParsedEvent>();
		const aliases = new Set<string>(survivor.aliases ?? []);
		for (const fam of [survivor, ...cluster.filter((f) => f !== survivor)]) {
			for (const child of fam.children) if (!children.has(child.childId)) children.set(child.childId, child);
			for (const event of fam.events) {
				const key = factsOf([event])[0];
				if (!events.has(key)) events.set(key, event);
			}
			if (fam !== survivor) {
				aliases.add(fam.id);
				for (const alias of fam.aliases ?? []) aliases.add(alias);
				removed.add(fam.id);
			}
		}
		replacement.set(survivor.id, {
			...survivor,
			children: [...children.values()],
			events: [...events.values()],
			...(aliases.size > 0 ? { aliases: [...aliases] } : {})
		});
	}

	return {
		parsed: {
			...parsed,
			families: parsed.families.filter((f) => !removed.has(f.id)).map((f) => replacement.get(f.id) ?? f)
		},
		mergedCount: removed.size
	};
}
