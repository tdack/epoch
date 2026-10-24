/** Builds `TreeRows` snapshots for pure tests of planning and ops, without a database. */

import type { EventRow, MediaRow, PersonNameRow, TreeRows } from '../domain/change-log';
import type { ParentChildType, UnionStatus } from '../../shared/relationship-model';
import type { Sex } from '../../shared/sex';
import { mediaLinkId } from '../../shared/media';

export const TEST_TREE_ID = 'tree-1';
const T0 = 1_000_000;

export interface RowsSpec {
	people?: Array<{
		id: string;
		givenName?: string | null;
		surname?: string | null;
		sex?: Sex;
		version?: number;
		birth?: string;
		death?: string | true;
	}>;
	unions?: Array<{
		id: string;
		partners: string[];
		status?: UnionStatus;
		version?: number;
		marriage?: string;
		xrefAliases?: string[];
	}>;
	links?: Array<{
		parentId: string;
		childId: string;
		type?: ParentChildType;
		unionId?: string | null;
	}>;
	events?: Array<Partial<EventRow> & { id: string; entityId: string; type: string }>;
	names?: Array<Partial<PersonNameRow> & { id: string; personId: string }>;
	/** `linkedTo` is the records the file is linked to; a file with none is detached. */
	media?: Array<Partial<MediaRow> & { id: string; linkedTo?: string[] }>;
	/** Citations of the facts, names, people or partnerships above, by what they support. */
	citations?: Array<{
		subjectKind: 'person' | 'name' | 'event' | 'union' | 'parent_child';
		subjectId: string;
	}>;
}

export function treeRows(spec: RowsSpec = {}): TreeRows {
	const rows: TreeRows = {
		individuals: [],
		personNames: [],
		unions: [],
		unionPartners: [],
		parentChild: [],
		events: [],
		mediaItems: [],
		mediaLinks: [],
		sources: [],
		repositories: [],
		sourceRepositories: [],
		citations: [],
		notes: [],
		noteAttachments: [],
		researchTasks: [],
		subtrees: []
	};
	for (const { linkedTo = [], ...m } of spec.media ?? []) {
		for (const entityId of linkedTo)
			rows.mediaLinks.push({
				id: mediaLinkId(m.id, entityId),
				treeId: TEST_TREE_ID,
				mediaId: m.id,
				entityId,
				createdAt: 1_000
			});
		rows.mediaItems.push({
			treeId: TEST_TREE_ID,
			r2ObjectKey: `media/${TEST_TREE_ID}/${m.id}.png`,
			cfImageId: null,
			title: null,
			mimeType: 'image/png',
			version: 1,
			createdAt: 1_000,
			updatedAt: 1_000,
			...m
		});
	}
	for (const [index, c] of (spec.citations ?? []).entries()) {
		rows.citations.push({
			id: `cite-${index}`,
			treeId: TEST_TREE_ID,
			subjectKind: c.subjectKind,
			subjectId: c.subjectId,
			sortOrder: index,
			sourceId: null,
			sourceRef: null,
			description: 'a register',
			page: null,
			quality: null,
			entryDateRaw: null,
			entryDateSort: null,
			entryDateSortEnd: null,
			entryDateQualifier: null,
			entryDatePrecision: null,
			entryDateCalendar: null,
			text: null,
			gedcomExtra: null,
			gedcomLayout: null,
			version: 1,
			createdAt: T0,
			updatedAt: T0
		});
	}
	const event = (
		partial: Partial<EventRow> & { id: string; entityId: string; type: string }
	): EventRow => ({
		treeId: TEST_TREE_ID,
		gedcomExtra: null,
		entityType: 'INDIVIDUAL',
		dateRaw: null,
		dateSort: null,
		dateSortEnd: null,
		dateQualifier: null,
		datePrecision: null,
		dateCalendar: null,
		place: null,
		description: null,
		value: null,
		cause: null,
		age: null,
		address: null,
		addressLayout: null,
		classification: null,
		agency: null,
		phone: null,
		email: null,
		fax: null,
		web: null,
		latitude: null,
		longitude: null,
		placeExtra: null,
		dateExtra: null,
		causeExtra: null,
		ageExtra: null,
		religion: null,
		notes: null,
		sortOrder: 0,
		version: 1,
		createdAt: T0,
		updatedAt: T0,
		...partial
	});

	for (const p of spec.people ?? []) {
		rows.individuals.push({
			id: p.id,
			treeId: TEST_TREE_ID,
			xrefId: `@${p.id}@`,
			xrefAliases: null,
			givenName: p.givenName ?? p.id,
			surname: p.surname ?? null,
			sex: p.sex ?? 'U',
			privacy: 'auto',
			createdBy: null,
			version: p.version ?? 1,
			createdAt: T0,
			updatedAt: T0
		});
		if (p.birth)
			rows.events.push(
				event({ id: `birt-${p.id}`, entityId: p.id, type: 'BIRT', dateRaw: p.birth })
			);
		if (p.death) {
			rows.events.push(
				event({
					id: `deat-${p.id}`,
					entityId: p.id,
					type: 'DEAT',
					dateRaw: p.death === true ? null : p.death
				})
			);
		}
	}
	for (const u of spec.unions ?? []) {
		rows.unions.push({
			id: u.id,
			treeId: TEST_TREE_ID,
			status: u.status ?? 'active',
			xrefAliases: u.xrefAliases ?? null,
			version: u.version ?? 1,
			createdAt: T0,
			updatedAt: T0
		});
		u.partners.forEach((personId, order) =>
			rows.unionPartners.push({
				id: `${u.id}-p${order}`,
				unionId: u.id,
				personId,
				order,
				createdAt: T0
			})
		);
		if (u.marriage) {
			rows.events.push(
				event({
					id: `marr-${u.id}`,
					entityType: 'FAMILY',
					entityId: u.id,
					type: 'MARR',
					dateRaw: u.marriage
				})
			);
		}
	}
	for (const [index, l] of (spec.links ?? []).entries()) {
		rows.parentChild.push({
			id: `link-${index}`,
			treeId: TEST_TREE_ID,
			parentId: l.parentId,
			childId: l.childId,
			type: l.type ?? 'biological',
			status: 'active',
			unionId: l.unionId ?? null,
			gedcomPedi: null,
			version: 1,
			createdAt: T0,
			updatedAt: T0
		});
	}
	for (const e of spec.events ?? []) rows.events.push(event(e));
	for (const [index, n] of (spec.names ?? []).entries()) {
		rows.personNames.push({
			type: 'birth',
			givenName: null,
			surname: null,
			namePrefix: null,
			nameSuffix: null,
			nickname: null,
			surnamePrefix: null,
			gedcomType: null,
			gedcomExtra: null,
			dateRaw: null,
			dateSort: null,
			dateSortEnd: null,
			dateQualifier: null,
			datePrecision: null,
			dateCalendar: null,
			unionId: null,
			isPreferred: false,
			order: index,
			version: 1,
			createdAt: T0,
			updatedAt: T0,
			...n
		});
	}
	return rows;
}

/** Deterministic ids for planning: `id-1`, `id-2`, ... */
export function sequentialIds(prefix = 'id'): () => string {
	let n = 0;
	return () => `${prefix}-${++n}`;
}
