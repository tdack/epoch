/**
 * GEDCOM persistence: the reads an import preview and an export need, and the writes of an import.
 * Parsing, previewing and shaping the export payload are pure and live in `gedcom/`; this is the
 * only place those modules meet D1.
 */

import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import { availableTreeSlug } from './tree-repository';
import {
	changeLog,
	citations,
	events,
	gedcomPreserved,
	individuals,
	noteAttachments,
	notes,
	parentChild,
	personNames,
	places,
	repositories,
	researchTasks,
	sourceRepositories,
	sources,
	trees,
	unionPartners,
	unions,
	type DbClient
} from '../db';
import { dateColumnsFor, type EventDateColumns } from '../domain/date-columns';
import type { ExportRows } from '../gedcom/export-payload';
import {
	eventContentKey,
	treeScopedId,
	type ImportMode,
	type PreviewRows
} from '../gedcom/import-preview';
import type { ParsedCitation, ParsedGedcomData } from '../gedcom/parser';
import { CITATION_SUBJECT_KINDS } from '../../shared/evidence';
import {
	importCitations,
	importRecords,
	recordTargets,
	type CitationTarget
} from './gedcom-evidence-writer';
import {
	importNoteAttachments,
	importSharedNotes,
	noteRecordTargets,
	type NoteTarget
} from './gedcom-note-writer';
import type { ParsedNoteLink } from '../gedcom/note-parse';
import { importNeutralModel } from './gedcom-neutral-writer';
import { chunkByParamLimit } from './param-chunks';
import { pointFactsAtPlaces } from './place-repository';

export interface ImportWrite {
	treeId: string;
	/** Names the tree when the import creates it. */
	treeName?: string;
	/** The file after any duplicate-family folding; the repository writes it as it is. */
	parsed: ParsedGedcomData;
	mode: ImportMode;
	/** Whether the tree row exists already: replace mode wipes it, merge mode adds to it. */
	isExistingTree: boolean;
}

export interface ImportWritten {
	individualsCount: number;
	familiesCount: number;
	eventsCount: number;
}

type EventValues = typeof events.$inferInsert & {
	dateQualifier: EventDateColumns['dateQualifier'];
};

export class GedcomRepository {
	constructor(private db: DbClient) {}

	async treeExists(treeId: string): Promise<boolean> {
		return !!(await this.db.select().from(trees).where(eq(trees.id, treeId)).get());
	}

	/**
	 * Rename a tree this import just created, conditionally: only while it still has the name and
	 * version the import saw. If a concurrent writer changed either, nothing happens — the import
	 * never overwrites a rename it did not see. A successful rename is logged as `import_tree_name`.
	 */
	async renameImportedTree(
		treeId: string,
		fromName: string,
		fromVersion: number,
		toName: string,
		actorId: string
	): Promise<boolean> {
		const now = new Date();
		const updated = await this.db
			.update(trees)
			.set({ name: toName, version: fromVersion + 1, updatedAt: now })
			.where(and(eq(trees.id, treeId), eq(trees.name, fromName), eq(trees.version, fromVersion)))
			.returning({ id: trees.id });
		if (updated.length === 0) return false;
		await this.db.insert(changeLog).values({
			id: crypto.randomUUID(),
			treeId,
			actorId,
			kind: 'import_tree_name',
			summary: `Named the imported tree '${toName}'`,
			changesJson: JSON.stringify([{ field: 'name', before: fromName, after: toName }]),
			inverseJson: null
		});
		return true;
	}

	/**
	 * How many people the tree holds, without loading one of them. `COUNT(*)` over the tree-scoped
	 * index, so it is cheap even for a tree far too large to export synchronously; the count only
	 * chooses the route, and the export itself re-reads the rows.
	 */
	async countIndividuals(treeId: string): Promise<number> {
		const row = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(individuals)
			.where(eq(individuals.treeId, treeId))
			.get();
		return row?.count ?? 0;
	}

	/** Alias XREF to surviving XREF for unions already in the tree that absorbed other families. */
	async aliasesInTree(treeId: string): Promise<Map<string, string>> {
		const map = new Map<string, string>();
		for (const union of await this.db
			.select()
			.from(unions)
			.where(eq(unions.treeId, treeId))
			.all()) {
			const survivor = union.id.startsWith(`${treeId}:`)
				? union.id.slice(treeId.length + 1)
				: union.id;
			for (const alias of union.xrefAliases ?? []) map.set(alias, survivor);
		}
		return map;
	}

	/** What an import preview compares the file against. */
	async previewRows(treeId: string): Promise<PreviewRows> {
		const [individualRows, unionRows, links, eventRows] = await Promise.all([
			this.db.select().from(individuals).where(eq(individuals.treeId, treeId)).all(),
			this.db.select().from(unions).where(eq(unions.treeId, treeId)).all(),
			this.db.select().from(parentChild).where(eq(parentChild.treeId, treeId)).all(),
			this.db.select().from(events).where(eq(events.treeId, treeId)).all()
		]);
		return {
			individuals: individualRows,
			unions: unionRows,
			parentChild: links,
			events: eventRows
		};
	}

	/**
	 * Persists parsed GEDCOM data using batch inserts chunked to D1's bound-parameter limit. Not
	 * atomic: a failure part way leaves what was written, as it always has.
	 */
	async writeImport({
		treeId,
		treeName,
		parsed,
		mode,
		isExistingTree
	}: ImportWrite): Promise<ImportWritten> {
		const db = this.db;
		if (!isExistingTree) {
			const name = treeName || parsed.treeName || 'Imported Tree';
			await db.insert(trees).values({
				id: treeId,
				slug: await availableTreeSlug(db, name),
				name,
				description: `Imported with ${parsed.individuals.length} individuals and ${parsed.families.length} families`,
				createdAt: new Date(),
				updatedAt: new Date()
			});
		} else if (mode === 'replace') {
			// Wipe all existing tree data before re-import. Notes first, then citations: attachments point
			// at shared notes and citations at sources, and the links between sources and repositories go
			// with their source.
			// A task about a fact would point at a record the new file gives another id; it stays, with
			// its link cleared. Tasks about people, partnerships, sources and notes keep theirs: those
			// records are given the same ids again from the file's XREFs.
			await db
				.update(researchTasks)
				.set({ linkClearedKind: 'event', subjectKind: null, subjectId: null })
				.where(and(eq(researchTasks.treeId, treeId), eq(researchTasks.subjectKind, 'event')));
			await db.delete(noteAttachments).where(eq(noteAttachments.treeId, treeId));
			await db.delete(notes).where(eq(notes.treeId, treeId));
			await db.delete(citations).where(eq(citations.treeId, treeId));
			await db.delete(sources).where(eq(sources.treeId, treeId));
			await db.delete(repositories).where(eq(repositories.treeId, treeId));
			await db.delete(events).where(eq(events.treeId, treeId));
			// What the old file kept verbatim goes with it; the new file brings its own, and a stale copy
			// would be written back beside it on every export.
			await db.delete(gedcomPreserved).where(eq(gedcomPreserved.treeId, treeId));
			// Records for the old facts' places would only be orphans; the import makes the ones it needs.
			await db.delete(places).where(eq(places.treeId, treeId));
			// Neutral tables: deleting unions cascades union_partners; parent_child and
			// person_names are removed via the individuals cascade below.
			await db.delete(unions).where(eq(unions.treeId, treeId));
			await db.delete(individuals).where(eq(individuals.treeId, treeId));
		}

		// 1. Prepare Individual Inserts
		const indValues = parsed.individuals.map((ind) => ({
			id: treeScopedId(treeId, ind.id),
			treeId,
			xrefId: ind.id,
			givenName: ind.givenName || null,
			surname: ind.surname || null,
			sex: ind.sex || 'U',
			privacy: ind.privacy ?? ('auto' as const),
			createdAt: new Date()
		}));

		// Batch insert individuals (10 columns generated by Drizzle: id, treeId, xrefId, givenName, surname, sex, privacy, version, createdAt, updatedAt)
		if (indValues.length > 0) {
			for (const chunk of chunkByParamLimit(indValues, 10)) {
				await db.insert(individuals).values(chunk).onConflictDoNothing();
			}
		}

		// 2. Neutral model: unions + union_partners + parent_child + person_names.
		// This is now the single source of truth; the legacy `families`/`family_children`
		// tables have been expunged.
		const neutralTargets = await importNeutralModel(db, treeId, parsed);
		const { sourceOf, noteTargets: recordNoteTargets } = await importRecords(db, treeId, parsed);
		const noteOf = await importSharedNotes(db, treeId, parsed);
		const scoped = (xref: string) => treeScopedId(treeId, xref);
		const targets: CitationTarget[] = [...recordTargets(parsed, scoped), ...neutralTargets];
		const noteTargets: NoteTarget[] = [...noteRecordTargets(parsed, scoped), ...recordNoteTargets];

		const eventValues: EventValues[] = [];
		// What each new event cites, by the id it is about to be given.
		const eventCitations = new Map<string, ParsedCitation[]>();
		const eventNotes = new Map<string, ParsedNoteLink[]>();
		for (const ind of parsed.individuals) {
			const scopedIndId = treeScopedId(treeId, ind.id);
			for (const ev of ind.events) {
				const id = crypto.randomUUID();
				eventCitations.set(id, ev.citations ?? []);
				eventNotes.set(id, ev.noteLinks ?? []);
				eventValues.push({
					id,
					treeId,
					entityType: 'INDIVIDUAL',
					entityId: scopedIndId,
					type: ev.type,
					dateRaw: ev.dateRaw || null,
					...dateColumnsFor(ev.dateRaw),
					place: ev.place || null,
					description: ev.description || null,
					value: ev.value || null,
					cause: ev.cause || null,
					age: ev.age || null,
					notes: ev.notes || null,
					gedcomExtra: ev.extra ?? null
				});
			}
		}

		for (const fam of parsed.families) {
			const scopedFamId = treeScopedId(treeId, fam.id);
			for (const ev of fam.events) {
				const id = crypto.randomUUID();
				eventCitations.set(id, ev.citations ?? []);
				eventNotes.set(id, ev.noteLinks ?? []);
				eventValues.push({
					id,
					treeId,
					entityType: 'FAMILY',
					entityId: scopedFamId,
					type: ev.type,
					dateRaw: ev.dateRaw || null,
					...dateColumnsFor(ev.dateRaw),
					place: ev.place || null,
					description: ev.description || null,
					value: null,
					cause: null,
					age: null,
					notes: null,
					gedcomExtra: ev.extra ?? null
				});
			}
		}

		if (mode === 'merge') {
			// Deduplicate events by content: skip rows identical to what's already stored and
			// intra-file repeats.
			const idByKey = new Map(
				(await db.select().from(events).where(eq(events.treeId, treeId)).all()).map(
					(row) => [eventContentKey(row), row.id] as const
				)
			);
			const deduped: EventValues[] = [];
			for (const ev of eventValues) {
				const key = eventContentKey(ev);
				const sameFactId = idByKey.get(key);
				if (sameFactId) {
					// The fact is stored already; what this copy of it cites joins the stored one's citations.
					targets.push({
						kind: CITATION_SUBJECT_KINDS.EVENT,
						id: sameFactId,
						citations: eventCitations.get(ev.id!) ?? [],
						notes: eventNotes.get(ev.id!) ?? []
					});
					continue;
				}
				idByKey.set(key, ev.id!);
				deduped.push(ev);
			}
			eventValues.length = 0;
			eventValues.push(...deduped);
		}
		for (const ev of eventValues) {
			targets.push({
				kind: CITATION_SUBJECT_KINDS.EVENT,
				id: ev.id!,
				citations: eventCitations.get(ev.id!) ?? [],
				notes: eventNotes.get(ev.id!) ?? []
			});
		}

		// Batch insert events. The column count comes from the schema, not a literal: every column is a
		// bound parameter, so a hardcoded count went stale when the fact detail columns were added and
		// would have sent statements over D1's limit.
		if (eventValues.length > 0) {
			const eventColumnCount = Object.keys(getTableColumns(events)).length;
			for (const chunk of chunkByParamLimit(eventValues, eventColumnCount)) {
				await db.insert(events).values(chunk).onConflictDoNothing();
			}
			await db.batch(pointFactsAtPlaces(db, treeId));
		}
		const citationNoteTargets = await importCitations(db, treeId, targets, sourceOf);
		await importNoteAttachments(
			db,
			treeId,
			[
				...noteTargets,
				...citationNoteTargets,
				...targets.map((t) => ({ kind: t.kind, id: t.id, notes: t.notes ?? [] }))
			],
			noteOf
		);

		return {
			individualsCount: indValues.length,
			familiesCount: parsed.families.length,
			eventsCount: eventValues.length
		};
	}

	/** Every row of the tree an export needs. */
	async loadExportRows(treeId: string): Promise<ExportRows> {
		const db = this.db;
		const tree = await db.select().from(trees).where(eq(trees.id, treeId)).get();
		const treeInds = await db
			.select()
			.from(individuals)
			.where(eq(individuals.treeId, treeId))
			.all();
		const treeUnions = await db.select().from(unions).where(eq(unions.treeId, treeId)).all();
		// union_partners has no tree_id; unscoped, this exported every tree's partners into every export.
		const treePartners = await db
			.select(getTableColumns(unionPartners))
			.from(unionPartners)
			.innerJoin(unions, eq(unionPartners.unionId, unions.id))
			.where(eq(unions.treeId, treeId))
			.all();
		const treeAssertions = await db
			.select()
			.from(parentChild)
			.where(eq(parentChild.treeId, treeId))
			.all();
		const treeEvents = await db
			.select()
			.from(events)
			.where(eq(events.treeId, treeId))
			.orderBy(sql`${events}.rowid`)
			.all();
		const treeNames = await db
			.select(getTableColumns(personNames))
			.from(personNames)
			.innerJoin(individuals, eq(personNames.personId, individuals.id))
			.where(eq(individuals.treeId, treeId))
			.orderBy(sql`${personNames}.rowid`)
			.all();
		const treePreserved = await db
			.select()
			.from(gedcomPreserved)
			.where(eq(gedcomPreserved.treeId, treeId))
			.all();
		const treeSources = await db
			.select()
			.from(sources)
			.where(eq(sources.treeId, treeId))
			.orderBy(sql`${sources}.rowid`)
			.all();
		const treeRepositories = await db
			.select()
			.from(repositories)
			.where(eq(repositories.treeId, treeId))
			.orderBy(sql`${repositories}.rowid`)
			.all();
		const treeSourceLinks = await db
			.select(getTableColumns(sourceRepositories))
			.from(sourceRepositories)
			.innerJoin(sources, eq(sourceRepositories.sourceId, sources.id))
			.where(eq(sources.treeId, treeId))
			.orderBy(sql`${sourceRepositories}.rowid`)
			.all();
		const treeCitations = await db
			.select()
			.from(citations)
			.where(eq(citations.treeId, treeId))
			.orderBy(sql`${citations}.rowid`)
			.all();
		const treeNotes = await db
			.select()
			.from(notes)
			.where(eq(notes.treeId, treeId))
			.orderBy(sql`${notes}.rowid`)
			.all();
		const treeNoteAttachments = await db
			.select()
			.from(noteAttachments)
			.where(eq(noteAttachments.treeId, treeId))
			.orderBy(sql`${noteAttachments}.rowid`)
			.all();
		return {
			tree,
			individuals: treeInds,
			unions: treeUnions,
			partners: treePartners,
			parentChild: treeAssertions,
			events: treeEvents,
			names: treeNames,
			preserved: treePreserved,
			sources: treeSources,
			repositories: treeRepositories,
			sourceRepositories: treeSourceLinks,
			citations: treeCitations,
			notes: treeNotes,
			noteAttachments: treeNoteAttachments
		};
	}
}
