/**
 * Migration adaptor from the legacy gendered prototype schema to the Phase 1
 * neutral model.
 *
 * This is a pure function (no I/O) so it can be unit tested and reused by both
 * a one-shot migration job and a dry-run report. It does not reinterpret
 * relationship semantics: the legacy family-wide `pedigree` is expanded into
 * per-parent assertions of the same type, and no spouse-pair merging occurs.
 */

import { parseDateValue } from './date-value';
import type {
	Event,
	ParentChild,
	ParentChildType,
	Person,
	PersonName,
	Union,
	UnionPartner,
	UnionStatus
} from './genealogy-model';

export interface LegacyIndividual {
	id: string;
	treeId: string;
	xrefId: string | null;
	givenName: string | null;
	surname: string | null;
	sex: 'M' | 'F' | 'X' | 'U';
	version: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface LegacyFamily {
	id: string;
	treeId: string;
	xrefId: string | null;
	husbandId: string | null;
	wifeId: string | null;
	version: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface LegacyFamilyChild {
	familyId: string;
	childId: string;
	pedigree: 'birth' | 'adopted' | 'foster' | null;
}

export interface LegacyEvent {
	id: string;
	treeId: string;
	entityType: 'INDIVIDUAL' | 'FAMILY';
	entityId: string;
	type: string;
	dateRaw: string | null;
	dateSort: string | null;
	place: string | null;
	description: string | null;
	version: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface LegacyData {
	individuals: LegacyIndividual[];
	families: LegacyFamily[];
	familyChildren: LegacyFamilyChild[];
	events: LegacyEvent[];
}

export interface NeutralData {
	persons: Person[];
	personNames: PersonName[];
	unions: Union[];
	unionPartners: UnionPartner[];
	parentChild: ParentChild[];
	events: Event[];
}

export interface MigrationReport {
	/** Count of families with no participants and no children (dropped, not reinterpreted). */
	emptyFamilies: number;
	/** Child links whose family no longer exists (dangling). */
	danglingChildLinks: number;
	/** Events whose entity no longer exists (dangling). */
	danglingEvents: number;
	/** Families whose union status was derived from a divorce event. */
	divorcedUnions: number;
	/** Individuals migrated. */
	individuals: number;
	/** Unions migrated. */
	unions: number;
	/** Parent-child assertions produced. */
	parentChildAssertions: number;
}

const PEDIGREE_TO_TYPE: Record<NonNullable<LegacyFamilyChild['pedigree']>, ParentChildType> = {
	birth: 'biological',
	adopted: 'adoptive',
	foster: 'foster'
};

function deriveUnionStatus(familyId: string, events: LegacyEvent[]): UnionStatus {
	const hasDivorce = events.some(
		(e) => e.entityType === 'FAMILY' && e.entityId === familyId && e.type === 'DIV'
	);
	return hasDivorce ? 'divorced' : 'active';
}

/**
 * Map legacy gendered data into the neutral model.
 *
 * Each legacy family becomes a union; its husband/wife become ordered
 * participants; each family-child link becomes one parent-child assertion per
 * participant, carrying the same relationship type derived from the legacy
 * family-wide pedigree. No spouse-pair merging is performed.
 */
export function migrateLegacyToNeutral(data: LegacyData): { result: NeutralData; report: MigrationReport } {
	const report: MigrationReport = {
		emptyFamilies: 0,
		danglingChildLinks: 0,
		danglingEvents: 0,
		divorcedUnions: 0,
		individuals: data.individuals.length,
		unions: 0,
		parentChildAssertions: 0
	};

	const persons: Person[] = [];
	const personNames: PersonName[] = [];
	const unions: Union[] = [];
	const unionPartners: UnionPartner[] = [];
	const parentChild: ParentChild[] = [];
	const events: Event[] = [];

	const familyIds = new Set(data.families.map((f) => f.id));
	const individualIds = new Set(data.individuals.map((i) => i.id));

	// Individuals -> persons + a single preferred birth name.
	for (const ind of data.individuals) {
		persons.push({
			id: ind.id,
			treeId: ind.treeId,
			version: ind.version,
			createdAt: ind.createdAt,
			updatedAt: ind.updatedAt
		});

		personNames.push({
			id: crypto.randomUUID(),
			personId: ind.id,
			type: 'birth',
			givenName: ind.givenName,
			surname: ind.surname,
			namePrefix: null,
			nameSuffix: null,
			isPreferred: true,
			order: 0
		});
	}

	// Families → Unions + ordered participants.
	for (const fam of data.families) {
		const participants: string[] = [];
		if (fam.husbandId) participants.push(fam.husbandId);
		if (fam.wifeId) participants.push(fam.wifeId);

		if (participants.length === 0) {
			// A family with no participants and no children carries no union
			// semantics; report it rather than fabricate an empty union.
			const hasChildren = data.familyChildren.some((c) => c.familyId === fam.id);
			if (!hasChildren) {
				report.emptyFamilies++;
				continue;
			}
		}

		const status = deriveUnionStatus(fam.id, data.events);
		if (status === 'divorced') report.divorcedUnions++;

		unions.push({
			id: fam.id,
			treeId: fam.treeId,
			status,
			version: fam.version,
			createdAt: fam.createdAt,
			updatedAt: fam.updatedAt
		});

		participants.forEach((personId, index) => {
			unionPartners.push({
				id: crypto.randomUUID(),
				unionId: fam.id,
				personId,
				order: index
			});
		});

		report.unions++;
	}

	// Family children → per-parent assertions.
	for (const link of data.familyChildren) {
		if (!familyIds.has(link.familyId)) {
			report.danglingChildLinks++;
			continue;
		}

		const fam = data.families.find((f) => f.id === link.familyId)!;
		const participants = [fam.husbandId, fam.wifeId].filter((id): id is string => Boolean(id));
		const type = link.pedigree ? PEDIGREE_TO_TYPE[link.pedigree] : 'unknown';

		for (const parentId of participants) {
			parentChild.push({
				id: crypto.randomUUID(),
				treeId: fam.treeId,
				parentId,
				childId: link.childId,
				type,
				status: 'active',
				unionId: fam.id,
				version: 1,
				createdAt: new Date(),
				updatedAt: new Date()
			});
			report.parentChildAssertions++;
		}
	}

	// Events → neutral events with parsed date values.
	for (const ev of data.events) {
		const entityExists =
			(ev.entityType === 'INDIVIDUAL' && individualIds.has(ev.entityId)) ||
			(ev.entityType === 'FAMILY' && familyIds.has(ev.entityId));
		if (!entityExists) {
			report.danglingEvents++;
			continue;
		}

		events.push({
			id: ev.id,
			treeId: ev.treeId,
			entityType: ev.entityType === 'INDIVIDUAL' ? 'PERSON' : 'UNION',
			entityId: ev.entityId,
			type: ev.type,
			date: parseDateValue(ev.dateRaw),
			place: ev.place,
			description: ev.description,
			version: ev.version,
			createdAt: ev.createdAt,
			updatedAt: ev.updatedAt
		});
	}

	return {
		result: { persons, personNames, unions, unionPartners, parentChild, events },
		report
	};
}