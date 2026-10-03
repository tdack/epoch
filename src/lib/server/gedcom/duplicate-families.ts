/**
 * Duplicate `FAM` records in a parsed GEDCOM, found before anything is written.
 *
 * Dirty files carry one family several times. The rules are deliberately narrow, because merging
 * two records that were really two families destroys a fact: only a two-partner family that
 * repeats, with identical facts and no disagreement about a child, is called an exact duplicate
 * and merged automatically. Everything else that looks alike is only reported.
 */

import { factKey, partnerSetKey } from '../../shared/union-merge';
import {
	mergeCitations,
	type ParsedEvent,
	type ParsedFamily,
	type ParsedGedcomData
} from './parser';
import {
	type DuplicateFamilyReport,
	type ExactDuplicateGroup,
	type PossibleDuplicateGroup,
	POSSIBLE_DUPLICATE_REASONS
} from '../../shared/duplicate-families';

const partnersOf = (fam: ParsedFamily) =>
	[fam.husbandId, fam.wifeId].filter((id): id is string => Boolean(id));

const factsOf = (events: ParsedEvent[]) =>
	events.map((e) =>
		factKey({
			type: e.type,
			dateText: e.dateRaw ?? null,
			place: e.place ?? null,
			description: e.description ?? null
		})
	);

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
			possible.push({
				familyIds: group.map((f) => f.id),
				reason: POSSIBLE_DUPLICATE_REASONS.SAME_SINGLE_PARTNER,
				partners: partnerNames(group[0])
			});
			continue;
		}

		const bySignature = new Map<string, ParsedFamily[]>();
		for (const fam of group)
			bySignature.set(signatureOf(fam), [...(bySignature.get(signatureOf(fam)) ?? []), fam]);

		const representatives: ParsedFamily[] = [];
		for (const cluster of bySignature.values()) {
			if (cluster.length < 2) {
				representatives.push(cluster[0]);
				continue;
			}
			if (hasChildConflict(cluster)) {
				possible.push({
					familyIds: cluster.map((f) => f.id),
					reason: POSSIBLE_DUPLICATE_REASONS.DIFFERENT_CHILD_RECORDS,
					partners: partnerNames(cluster[0])
				});
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
			possible.push({
				familyIds: representatives.map((f) => f.id),
				reason: POSSIBLE_DUPLICATE_REASONS.DIFFERENT_FACTS,
				partners: partnerNames(group[0])
			});
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
			possible.push({
				familyIds: [fam.id, ...fuller.map((f) => f.id)],
				reason: POSSIBLE_DUPLICATE_REASONS.SUBSET_OF_FULL_FAMILY,
				partners: partnerNames(fam)
			});
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
export function mergeExactDuplicateFamilies(parsed: ParsedGedcomData): {
	parsed: ParsedGedcomData;
	mergedCount: number;
} {
	const { clusters } = analyse(parsed);
	if (clusters.length === 0) return { parsed, mergedCount: 0 };

	const removed = new Set<string>();
	const replacement = new Map<string, ParsedFamily>();
	for (const cluster of clusters) {
		const survivor = survivorOf(cluster);
		const children = new Map<string, ParsedFamily['children'][number]>();
		const events = new Map<string, ParsedEvent>();
		const aliases = new Set<string>(survivor.aliases ?? []);
		let familyCitations = survivor.citations;
		for (const fam of [survivor, ...cluster.filter((f) => f !== survivor)]) {
			// What a repeated record cites is evidence, and is kept on the record that absorbs it.
			familyCitations = mergeCitations(familyCitations, fam.citations);
			for (const child of fam.children) {
				const kept = children.get(child.childId);
				if (!kept) children.set(child.childId, child);
				else if (child.citations)
					children.set(child.childId, {
						...kept,
						citations: mergeCitations(kept.citations ?? [], child.citations)
					});
			}
			for (const event of fam.events) {
				const key = factsOf([event])[0];
				const kept = events.get(key);
				if (!kept) events.set(key, event);
				else if (event.citations)
					events.set(key, {
						...kept,
						citations: mergeCitations(kept.citations ?? [], event.citations)
					});
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
			citations: familyCitations,
			...(aliases.size > 0 ? { aliases: [...aliases] } : {})
		});
	}

	return {
		parsed: {
			...parsed,
			families: parsed.families
				.filter((f) => !removed.has(f.id))
				.map((f) => replacement.get(f.id) ?? f)
		},
		mergedCount: removed.size
	};
}

/**
 * Families in an incoming file whose XREF is an alias of a union already in the tree, folded into
 * that union. Without this a merge-mode re-import of a file that was merged the first time would
 * write the merged-away `FAM` records again, because the importer identifies a union by XREF and
 * an alias is not the union's own XREF.
 *
 * @param survivorOfAlias Alias XREF to the XREF of the union it was merged into.
 */
export function foldIntoExistingAliases(
	parsed: ParsedGedcomData,
	survivorOfAlias: Map<string, string>
): { parsed: ParsedGedcomData; foldedCount: number } {
	if (!parsed.families.some((f) => survivorOfAlias.has(f.id))) return { parsed, foldedCount: 0 };

	const families = new Map<string, ParsedFamily>();
	let foldedCount = 0;
	for (const fam of parsed.families) {
		const target = survivorOfAlias.get(fam.id) ?? fam.id;
		if (target !== fam.id) foldedCount++;
		const existing = families.get(target);
		if (!existing) {
			families.set(target, { ...fam, id: target });
			continue;
		}
		// Two records now name one union: keep everything either says, without repeating a child or a fact.
		const children = new Map(existing.children.map((c) => [c.childId, c] as const));
		for (const child of fam.children) {
			const kept = children.get(child.childId);
			if (!kept) children.set(child.childId, child);
			else if (child.citations)
				children.set(child.childId, {
					...kept,
					citations: mergeCitations(kept.citations ?? [], child.citations)
				});
		}
		const events = new Map(existing.events.map((e) => [factsOf([e])[0], e] as const));
		for (const event of fam.events) {
			const key = factsOf([event])[0];
			const kept = events.get(key);
			if (!kept) events.set(key, event);
			else if (event.citations)
				events.set(key, {
					...kept,
					citations: mergeCitations(kept.citations ?? [], event.citations)
				});
		}
		families.set(target, {
			...existing,
			husbandId: existing.husbandId ?? fam.husbandId,
			wifeId: existing.wifeId ?? fam.wifeId,
			children: [...children.values()],
			events: [...events.values()],
			citations: mergeCitations(existing.citations, fam.citations)
		});
	}

	const remap = (ids: string[] | undefined) =>
		ids ? [...new Set(ids.map((id) => survivorOfAlias.get(id) ?? id))] : ids;
	return {
		parsed: {
			...parsed,
			families: [...families.values()],
			individuals: parsed.individuals.map((ind) => ({
				...ind,
				famc: remap(ind.famc),
				fams: remap(ind.fams),
				famcLinks: ind.famcLinks?.map((link) => ({
					...link,
					familyId: survivorOfAlias.get(link.familyId) ?? link.familyId
				}))
			}))
		},
		foldedCount
	};
}
