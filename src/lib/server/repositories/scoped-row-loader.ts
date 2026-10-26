/**
 * Loads a write's scoped snapshot from D1 (ADR-055): exactly the rows `selectScope` picks from the
 * whole tree for the same seed, in the same order, but without reading the whole tree.
 *
 * It follows the closure in `domain/write-scope.ts` rule by rule. Each rule says "for these ids, read
 * those rows"; a wave sends every rule that has new ids in one parallel round, folds the rows in,
 * derives the larger id sets they imply, and goes again until no rule has anything new to ask. The
 * ids a rule has already asked are remembered, so nothing is read twice. Because every set only
 * grows and each rule reads only what the closure selects, the order rules fire in cannot change
 * the result, only how many waves it takes.
 *
 * The rules themselves are the closure's, restated as reads; `scoped-load.test.ts` proves they
 * agree with `selectScope`.
 */

import type { DbClient } from '../db';
import type { TreeRows } from '../domain/change-log';
import type { ScopeSeed } from '../domain/write-scope';
import { SUBJECT } from '../domain/write-scope';
import { ChangeStore } from './change-store';
import type { Ranked, Read } from './graph-window-repository';
import { ScopedReads } from './scoped-reads';

/** Statements per `db.batch`, as in `GraphWindowRepository`. */
const STATEMENTS_PER_BATCH = 40;

type Key = keyof TreeRows;
type RowOf<K extends Key> = TreeRows[K][number];

/** What a load cost, for the write-cost record and the tests. */
export interface ScopedLoadStats {
	/** Parallel waves: the sequential round trips a load needs. */
	waves: number;
	/** `db.batch` calls sent, which a wave may split across when it is wider than one batch. */
	batches: number;
}

interface Pending {
	into: Key;
	read: Read<Array<Ranked<{ id: string }>>>;
	/** Called with the rows once they are in, for rules that learn something from their shape. */
	onRows?: (rows: Array<{ id: string }>) => void;
}

export class ScopedRowLoader {
	private reads: ScopedReads;
	private store: ChangeStore;
	/** Set by each load; read by tests and the cost record. */
	lastStats: ScopedLoadStats = { waves: 0, batches: 0 };

	constructor(db: DbClient) {
		this.reads = new ScopedReads(db);
		this.store = new ChangeStore(db);
	}

	async load(treeId: string, seed: ScopeSeed): Promise<TreeRows> {
		const { reads } = this;
		const stats: ScopedLoadStats = { waves: 0, batches: 0 };

		const maps: { [K in Key]: Map<string, Ranked<RowOf<K>>> } = {
			individuals: new Map(),
			personNames: new Map(),
			unions: new Map(),
			unionPartners: new Map(),
			parentChild: new Map(),
			events: new Map(),
			mediaItems: new Map(),
			mediaLinks: new Map(),
			sources: new Map(),
			repositories: new Map(),
			sourceRepositories: new Map(),
			citations: new Map(),
			notes: new Map(),
			noteAttachments: new Map(),
			researchTasks: new Map(),
			subtrees: new Map(),
			placeLocations: new Map()
		};

		// Resolved ids: what the seeds name, and what those records are about. They may name records
		// the tree does not have; a read for such an id returns nothing, as `selectScope` drops them.
		const rPeople = new Set(seed.people);
		const rUnions = new Set(seed.unions);
		const rEvents = new Set(seed.events);
		const rNames = new Set(seed.names);
		const rLinks = new Set(seed.links);
		const rCitations = new Set(seed.citations);
		const rSources = new Set([...seed.sources, ...seed.bareSources]);
		const rRepositories = new Set(seed.repositories);
		const rNotes = new Set(seed.notes);
		const rAttachments = new Set(seed.noteAttachments);
		const rTasks = new Set(seed.tasks);
		const seededLinks = new Set(seed.sourceRepositories);
		const seededMedia = new Set(seed.media);

		const processed = new Set<string>();
		const asked = new Map<string, Set<string>>();
		/** Partnerships whose every partner row is already in. */
		const completeUnions = new Set<string>();

		const addSubject = (kind: string | null, id: string | null) => {
			if (!kind || !id) return;
			switch (kind) {
				case SUBJECT.PERSON:
					rPeople.add(id);
					break;
				case SUBJECT.NAME:
					rNames.add(id);
					break;
				case SUBJECT.EVENT:
					rEvents.add(id);
					break;
				case SUBJECT.UNION:
					rUnions.add(id);
					break;
				case SUBJECT.LINK:
					rLinks.add(id);
					break;
				case SUBJECT.SOURCE:
					rSources.add(id);
					break;
				case SUBJECT.CITATION:
					rCitations.add(id);
					break;
				case SUBJECT.REPOSITORY:
					rRepositories.add(id);
					break;
				case SUBJECT.NOTE:
					rNotes.add(id);
					break;
			}
		};

		/** Apply the resolution rules to every resolved row that has arrived and not been applied. */
		const resolve = () => {
			const once = (set: ReadonlySet<string>, kind: string, apply: (id: string) => void) => {
				for (const id of [...set]) {
					const key = `${kind}:${id}`;
					if (processed.has(key)) continue;
					processed.add(key);
					apply(id);
				}
			};
			// A row not yet in must be retried once it arrives, so unprocess ids whose row is missing.
			const guarded =
				<R>(map: Map<string, Ranked<R>>, kind: string, fn: (row: R) => void) =>
				(id: string) => {
					const row = map.get(id)?.row;
					if (row) fn(row);
					else processed.delete(`${kind}:${id}`);
				};
			// Pulls: only the seeded source's citations and the seeded note's attachments.
			for (const [id, { row }] of maps.citations)
				if (row.sourceId && seed.sources.has(row.sourceId)) rCitations.add(id);
			for (const [id, { row }] of maps.noteAttachments)
				if (row.noteId && seed.notes.has(row.noteId)) rAttachments.add(id);

			once(
				rEvents,
				'event',
				guarded(maps.events, 'event', (e) =>
					addSubject(e.entityType === 'FAMILY' ? SUBJECT.UNION : SUBJECT.PERSON, e.entityId)
				)
			);
			once(
				rNames,
				'name',
				guarded(maps.personNames, 'name', (n) => addSubject(SUBJECT.PERSON, n.personId))
			);
			once(
				rLinks,
				'link',
				guarded(maps.parentChild, 'link', (l) => {
					addSubject(SUBJECT.PERSON, l.parentId);
					addSubject(SUBJECT.PERSON, l.childId);
					addSubject(SUBJECT.UNION, l.unionId);
				})
			);
			// A seeded file resolves the records it is linked to; the files other links name do not.
			for (const { row } of maps.mediaLinks.values())
				if (seededMedia.has(row.mediaId)) {
					addSubject(SUBJECT.PERSON, row.entityId);
					addSubject(SUBJECT.UNION, row.entityId);
				}
			once(
				rCitations,
				'citation',
				guarded(maps.citations, 'citation', (c) => {
					addSubject(c.subjectKind, c.subjectId);
					addSubject(SUBJECT.SOURCE, c.sourceId);
				})
			);
			once(
				rAttachments,
				'attachment',
				guarded(maps.noteAttachments, 'attachment', (a) => {
					addSubject(a.subjectKind, a.subjectId);
					addSubject(SUBJECT.NOTE, a.noteId);
				})
			);
			once(
				rTasks,
				'task',
				guarded(maps.researchTasks, 'task', (t) => addSubject(t.subjectKind, t.subjectId))
			);
			// A seeded link resolves to its source and repository; it pulls neither.
			once(
				seededLinks,
				'sourceRepository',
				guarded(maps.sourceRepositories, 'sourceRepository', (l) => {
					addSubject(SUBJECT.SOURCE, l.sourceId);
					addSubject(SUBJECT.REPOSITORY, l.repositoryId);
				})
			);
		};

		/** Ids a rule has not asked yet; marks them asked. */
		const fresh = (rule: string, ids: Iterable<string | null | undefined>): string[] => {
			let seen = asked.get(rule);
			if (!seen) asked.set(rule, (seen = new Set()));
			const out: string[] = [];
			for (const id of ids) {
				if (typeof id !== 'string' || seen.has(id)) continue;
				seen.add(id);
				out.push(id);
			}
			return out;
		};

		const idsOf = (map: Map<string, unknown>) => [...map.keys()];

		for (;;) {
			resolve();

			// Partnerships: the seeded and resolved ones, plus every one a resolved person is in.
			const unionSet = new Set(rUnions);
			for (const { row } of maps.unionPartners.values())
				if (rPeople.has(row.personId)) unionSet.add(row.unionId);
			const partners = new Set<string>();
			for (const { row } of maps.unionPartners.values())
				if (unionSet.has(row.unionId)) partners.add(row.personId);
			const partnerOrResolved = new Set([...rPeople, ...partners]);
			const farEnds = new Set<string>();
			for (const { row } of maps.parentChild.values()) {
				farEnds.add(row.parentId);
				farEnds.add(row.childId);
			}
			const everyone = new Set([...partnerOrResolved, ...farEnds]);

			// Evidence reaches the final loaded records.
			const sourceSet = new Set(rSources);
			for (const { row } of maps.citations.values()) if (row.sourceId) sourceSet.add(row.sourceId);
			const repositorySet = new Set(rRepositories);
			for (const { row } of maps.sourceRepositories.values())
				if (sourceSet.has(row.sourceId) && row.repositoryId) repositorySet.add(row.repositoryId);
			const noteSet = new Set(rNotes);
			for (const { row } of maps.noteAttachments.values()) if (row.noteId) noteSet.add(row.noteId);

			const pending: Pending[] = [];
			const add = <K extends Key>(
				into: K,
				read: Read<Array<Ranked<RowOf<K>>>>,
				onRows?: (rows: Array<RowOf<K>>) => void
			) => {
				pending.push({
					into,
					read: read as unknown as Pending['read'],
					onRows: onRows as Pending['onRows']
				});
			};

			// The seeded and resolved records themselves.
			const people = fresh('individuals', everyone);
			if (people.length > 0) add('individuals', reads.individualsIn(treeId, people));
			const unionIds = fresh('unions', unionSet);
			if (unionIds.length > 0) add('unions', reads.unionsIn(treeId, unionIds));
			const eventIds = fresh('eventsIn', rEvents);
			if (eventIds.length > 0) add('events', reads.eventsIn(treeId, eventIds));
			const nameIds = fresh('namesIn', rNames);
			if (nameIds.length > 0) add('personNames', reads.namesIn(treeId, nameIds));
			const linkIds = fresh('linksIn', rLinks);
			if (linkIds.length > 0) add('parentChild', reads.linksIn(treeId, linkIds));
			// A seeded file brings all its links; the file a link names comes with it.
			const seededMediaIds = fresh('mediaLinksOfMedia', seededMedia);
			if (seededMediaIds.length > 0)
				add('mediaLinks', reads.mediaLinksOfMedia(treeId, seededMediaIds));
			const mediaIds = fresh('mediaIn', [
				...seededMedia,
				...[...maps.mediaLinks.values()].map(({ row }) => row.mediaId)
			]);
			if (mediaIds.length > 0) add('mediaItems', reads.mediaIn(treeId, mediaIds));
			const citationIds = fresh('citationsIn', rCitations);
			if (citationIds.length > 0) add('citations', reads.citationsIn(treeId, citationIds));
			const pulledSources = fresh('citationsOfSources', seed.sources);
			if (pulledSources.length > 0)
				add('citations', reads.citationsOfSources(treeId, pulledSources));
			const sourceIds = fresh('sourcesIn', sourceSet);
			if (sourceIds.length > 0) add('sources', reads.sourcesIn(treeId, sourceIds));
			const repositoryIds = fresh('repositoriesIn', repositorySet);
			if (repositoryIds.length > 0)
				add('repositories', reads.repositoriesIn(treeId, repositoryIds));
			const noteIds = fresh('notesIn', noteSet);
			if (noteIds.length > 0) add('notes', reads.notesIn(treeId, noteIds));
			const attachmentIds = fresh('attachmentsIn', rAttachments);
			if (attachmentIds.length > 0)
				add('noteAttachments', reads.attachmentsIn(treeId, attachmentIds));
			const pulledNotes = fresh('attachmentsOfNotes', seed.notes);
			if (pulledNotes.length > 0)
				add('noteAttachments', reads.attachmentsOfNotes(treeId, pulledNotes));
			const taskIds = fresh('tasksIn', rTasks);
			if (taskIds.length > 0) add('researchTasks', reads.tasksIn(treeId, taskIds));
			// Sub-trees: the seeded ones, and any rooted at a resolved person.
			const subtreeIds = fresh('subtreesIn', seed.subtrees);
			if (subtreeIds.length > 0) add('subtrees', reads.subtreesIn(treeId, subtreeIds));
			const rootedAt = fresh('subtreesRootedAt', rPeople);
			if (rootedAt.length > 0) add('subtrees', reads.subtreesRootedAt(treeId, rootedAt));
			const locationIds = fresh('placeLocationsIn', seed.placeLocations);
			if (locationIds.length > 0)
				add('placeLocations', reads.placeLocationsIn(treeId, locationIds));
			const seededLinkIds = fresh('sourceRepositoriesIn', seededLinks);
			if (seededLinkIds.length > 0)
				add('sourceRepositories', reads.sourceRepositoriesIn(treeId, seededLinkIds));
			const pulledRepositories = fresh('sourceRepositoriesOfRepositories', seed.repositories);
			if (pulledRepositories.length > 0)
				add(
					'sourceRepositories',
					reads.sourceRepositoriesOfRepositories(treeId, pulledRepositories)
				);

			// Partners: a resolved person's partnerships with all their partners at once.
			const coPartnered = fresh('coPartnerRows', rPeople);
			if (coPartnered.length > 0)
				add('unionPartners', reads.coPartnerRows(treeId, coPartnered), (rows) => {
					for (const row of rows as Array<{ unionId: string }>) completeUnions.add(row.unionId);
				});
			const incomplete = [...unionSet].filter((id) => !completeUnions.has(id));
			const partnerUnions = fresh('partnerRowsOfUnions', incomplete);
			if (partnerUnions.length > 0)
				add('unionPartners', reads.partnerRowsOfUnions(treeId, partnerUnions), () => {
					for (const id of partnerUnions) completeUnions.add(id);
				});

			// Links touching a resolved person, a partner or a partnership.
			const linkPeople = fresh('linksTouching', partnerOrResolved);
			if (linkPeople.length > 0) {
				add('parentChild', reads.linksBy(treeId, 'child', linkPeople));
				add('parentChild', reads.linksBy(treeId, 'parent', linkPeople));
			}
			const linkUnions = fresh('linksOfUnions', unionSet);
			if (linkUnions.length > 0) add('parentChild', reads.linksBy(treeId, 'union', linkUnions));

			// Everyone loaded brings names, individual events and files; partnerships their events and files.
			const namedPeople = fresh('namesOf', everyone);
			if (namedPeople.length > 0) add('personNames', reads.namesOf(treeId, namedPeople));
			const eventPeople = fresh('eventsOfPeople', everyone);
			if (eventPeople.length > 0) add('events', reads.eventsOf(treeId, 'INDIVIDUAL', eventPeople));
			const eventUnions = fresh('eventsOfUnions', unionSet);
			if (eventUnions.length > 0) add('events', reads.eventsOf(treeId, 'FAMILY', eventUnions));
			// A seeded source brings its files too, so a delete or merge of it sees what to detach or move.
			const mediaOwners = fresh('mediaOf', [...everyone, ...unionSet, ...seed.sources]);
			if (mediaOwners.length > 0) add('mediaLinks', reads.mediaLinksOf(treeId, mediaOwners));

			// What is attached to everything loaded.
			const subjectSets: Array<[string, Iterable<string>]> = [
				[SUBJECT.PERSON, everyone],
				[SUBJECT.NAME, idsOf(maps.personNames)],
				[SUBJECT.EVENT, idsOf(maps.events)],
				[SUBJECT.UNION, unionSet],
				[SUBJECT.LINK, idsOf(maps.parentChild)]
			];
			for (const [kind, ids] of subjectSets) {
				const forCitations = fresh(`citations:${kind}`, ids);
				if (forCitations.length > 0)
					add(
						'citations',
						reads.citationsBySubject(
							treeId,
							kind as Parameters<ScopedReads['citationsBySubject']>[1],
							forCitations
						)
					);
			}
			const attachable: Array<[string, Iterable<string>]> = [
				...subjectSets,
				[SUBJECT.SOURCE, sourceSet],
				[SUBJECT.REPOSITORY, repositorySet],
				[SUBJECT.CITATION, idsOf(maps.citations)]
			];
			for (const [kind, ids] of attachable) {
				const forAttachments = fresh(`attachments:${kind}`, ids);
				if (forAttachments.length > 0)
					add(
						'noteAttachments',
						reads.attachmentsBySubject(
							treeId,
							kind as Parameters<ScopedReads['attachmentsBySubject']>[1],
							forAttachments
						)
					);
			}
			const taskable: Array<[string, Iterable<string>]> = [
				[SUBJECT.PERSON, everyone],
				[SUBJECT.UNION, unionSet],
				[SUBJECT.EVENT, idsOf(maps.events)],
				[SUBJECT.SOURCE, sourceSet],
				[SUBJECT.NOTE, noteSet]
			];
			for (const [kind, ids] of taskable) {
				const forTasks = fresh(`tasks:${kind}`, ids);
				if (forTasks.length > 0)
					add(
						'researchTasks',
						reads.tasksBySubject(
							treeId,
							kind as Parameters<ScopedReads['tasksBySubject']>[1],
							forTasks
						)
					);
			}
			const linkedSources = fresh('sourceRepositoriesOfSources', sourceSet);
			if (linkedSources.length > 0)
				add('sourceRepositories', reads.sourceRepositoriesOfSources(treeId, linkedSources));

			if (pending.length === 0) break;
			stats.waves += 1;
			stats.batches += await this.send(pending, maps);
		}

		this.lastStats = stats;

		const table = <K extends Key>(key: K) =>
			[...maps[key].values()]
				.sort((x, y) => x.rid - y.rid)
				.map((ranked) => ranked.row) as TreeRows[K];
		const wholeKeys = (seed.wholeTables ?? []) as Key[];
		const wholeRows = await Promise.all(wholeKeys.map((key) => this.store.loadTable(treeId, key)));

		const result = {
			individuals: table('individuals'),
			personNames: table('personNames'),
			unions: table('unions'),
			unionPartners: table('unionPartners'),
			parentChild: table('parentChild'),
			events: table('events'),
			mediaItems: table('mediaItems'),
			mediaLinks: table('mediaLinks'),
			sources: table('sources'),
			repositories: table('repositories'),
			sourceRepositories: table('sourceRepositories'),
			citations: table('citations'),
			notes: table('notes'),
			noteAttachments: table('noteAttachments'),
			researchTasks: table('researchTasks'),
			subtrees: table('subtrees'),
			placeLocations: table('placeLocations')
		} as TreeRows;
		wholeKeys.forEach((key, i) => {
			(result as unknown as Record<string, unknown>)[key] = wholeRows[i];
		});
		return result;
	}

	/** Send one wave in parallel batches and fold the rows into the maps; returns the batches sent. */
	private async send(
		pending: Pending[],
		maps: { [K in Key]: Map<string, Ranked<RowOf<K>>> }
	): Promise<number> {
		const statements = pending.flatMap((p) => p.read.queries);
		const chunks: (typeof statements)[] = [];
		for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH)
			chunks.push(statements.slice(i, i + STATEMENTS_PER_BATCH));
		const sent = await Promise.all(
			chunks.map(
				(chunk) =>
					this.reads.client.batch(chunk as [(typeof chunk)[0], ...typeof chunk]) as Promise<
						unknown[][]
					>
			)
		);
		const results = sent.flat();
		let offset = 0;
		for (const p of pending) {
			const slice = results.slice(offset, offset + p.read.queries.length);
			offset += p.read.queries.length;
			const rows = p.read.finish(slice);
			const into = maps[p.into] as Map<string, Ranked<{ id: string }>>;
			for (const ranked of rows) into.set(ranked.row.id, ranked);
			p.onRows?.(rows.map((r) => r.row));
		}
		return chunks.length;
	}
}
