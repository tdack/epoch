/**
 * The scoped snapshot a write plans over (ADR-055): a seed names the records a command reads, and
 * `selectScope` picks from a whole-tree snapshot exactly what the planners may look at. The D1
 * loader (`ChangeStore.loadScoped`) must return the same rows in the same order; the tests hold the
 * two together, and the equivalence harness holds the selection against the whole tree.
 *
 * The closure, in the order it is applied:
 *
 * 1. Resolve. Every seeded record resolves to the people and partnerships it is about: an event to
 *    its person or partnership, a name to its person, a citation to its subject and its source, a
 *    note attachment to its subject and its note, a task to its subject, a file to its owner, a
 *    link to both people and its partnership. This repeats until nothing new appears, because a
 *    note on a citation resolves through the citation to its subject.
 *    A `source_repositories` link resolves to its source and its repository.
 * 2. Pull. A seeded source brings its citations, a seeded shared note its attachments, a seeded
 *    repository its `source_repositories` rows. Only a direct seed pulls: a source that is loaded
 *    merely because a citation names it does not bring every other citation of it.
 * 3. People (A) are everyone resolved. Their partnerships join the seeded ones (U); every partner
 *    of those (B) is loaded.
 * 4. Links are every `parent_child` row touching A, B or U. The people at their other ends (C) are
 *    loaded, but bring no partnerships of their own.
 * 5. Every person of A, B and C brings all their names and individual events, because privacy
 *    (ADR-015) and the labeller read them; every partnership its family events; every person and
 *    partnership its files.
 * 6. Attached records: citations on anything loaded, with their sources, those sources'
 *    `source_repositories` rows and repositories; note attachments on anything loaded (people,
 *    names, events, partnerships, links, sources, repositories, citations) with their notes; tasks
 *    about anything loaded.
 * 7. Sub-trees: the seeded ones, and those rooted at a resolved person (step 1), so a merge sees
 *    the sub-trees it must repoint. A sub-tree has no foreign key to its root, so deleting a person
 *    does not touch one.
 *
 * `wholeTables` copies whole tables on top, for the one command that reads a table end to end.
 * Every table keeps the order of `whole`, because chronology tie-breaks depend on `rowid`.
 */

import type { TreeRows } from './change-log';

/** The records a command reads, by id. An id that does not exist in the tree selects nothing. */
export interface ScopeSeed {
	readonly people: ReadonlySet<string>;
	readonly unions: ReadonlySet<string>;
	readonly events: ReadonlySet<string>;
	readonly names: ReadonlySet<string>;
	/** `parent_child` row ids. */
	readonly links: ReadonlySet<string>;
	readonly media: ReadonlySet<string>;
	readonly citations: ReadonlySet<string>;
	readonly sources: ReadonlySet<string>;
	/**
	 * Sources loaded as rows alone, as one a citation names is: they pull neither their citations nor
	 * their files. Only for a caller who sees everything, who never needs every citation to tell a
	 * hidden source from a present one.
	 */
	readonly bareSources: ReadonlySet<string>;
	readonly repositories: ReadonlySet<string>;
	readonly notes: ReadonlySet<string>;
	readonly noteAttachments: ReadonlySet<string>;
	readonly tasks: ReadonlySet<string>;
	/** `subtree` row ids. A person in the seed also brings the sub-trees rooted at them. */
	readonly subtrees: ReadonlySet<string>;
	/** `source_repositories` row ids. A link resolves to its source and its repository; it pulls neither. */
	readonly sourceRepositories: ReadonlySet<string>;
	/** Tables to read whole on top of the closure, as `assert_parent_child` does for `parentChild`. */
	readonly wholeTables?: ReadonlyArray<keyof TreeRows>;
	/**
	 * Opts the command into a second load (`write-scope/follow-up.ts`): its sentence or checks read
	 * partnerships that no seed can name, so they are found in the first snapshot and loaded next.
	 * The selector ignores it; only `followUpSeed` and the runner read it.
	 */
	readonly shouldFollowFamily?: boolean;
	/**
	 * Opts the command into the evidence follow-up: whether a restricted viewer sees a note, task,
	 * source or repository depends on records that are found only in the first snapshot (the sources
	 * a repository is linked from, the citations of a source a note sits on), so they are seeded and
	 * loaded next. The selector ignores it.
	 */
	readonly shouldFollowEvidence?: boolean;
}

type IdKey = Exclude<
	keyof ScopeSeed,
	'wholeTables' | 'shouldFollowFamily' | 'shouldFollowEvidence'
>;

const ID_KEYS: readonly IdKey[] = [
	'people',
	'unions',
	'events',
	'names',
	'links',
	'media',
	'citations',
	'sources',
	'bareSources',
	'repositories',
	'notes',
	'noteAttachments',
	'tasks',
	'subtrees',
	'sourceRepositories'
];

export function emptySeed(): ScopeSeed {
	return {
		people: new Set(),
		unions: new Set(),
		events: new Set(),
		names: new Set(),
		links: new Set(),
		media: new Set(),
		citations: new Set(),
		sources: new Set(),
		bareSources: new Set(),
		repositories: new Set(),
		notes: new Set(),
		noteAttachments: new Set(),
		tasks: new Set(),
		subtrees: new Set(),
		sourceRepositories: new Set()
	};
}

/** A seed from lists of ids, so a command's seed reads as one literal. */
export function seedOf(
	ids: Partial<Record<IdKey, Iterable<string | null | undefined>>> & {
		wholeTables?: ReadonlyArray<keyof TreeRows>;
		shouldFollowFamily?: boolean;
		shouldFollowEvidence?: boolean;
	}
): ScopeSeed {
	const seed: Record<string, unknown> = { ...emptySeed() };
	for (const key of ID_KEYS) {
		const given = ids[key];
		if (!given) continue;
		seed[key] = new Set([...given].filter((id): id is string => typeof id === 'string'));
	}
	if (ids.wholeTables) seed.wholeTables = ids.wholeTables;
	if (ids.shouldFollowFamily) seed.shouldFollowFamily = true;
	if (ids.shouldFollowEvidence) seed.shouldFollowEvidence = true;
	return seed as unknown as ScopeSeed;
}

export function mergeSeeds(a: ScopeSeed, b: ScopeSeed): ScopeSeed {
	const merged: Record<string, unknown> = {};
	for (const key of ID_KEYS) merged[key] = new Set([...a[key], ...b[key]]);
	const whole = [...new Set([...(a.wholeTables ?? []), ...(b.wholeTables ?? [])])];
	if (whole.length > 0) merged.wholeTables = whole;
	if (a.shouldFollowFamily || b.shouldFollowFamily) merged.shouldFollowFamily = true;
	if (a.shouldFollowEvidence || b.shouldFollowEvidence) merged.shouldFollowEvidence = true;
	return merged as unknown as ScopeSeed;
}

/** What a subject column can name, shared by citations, note attachments and tasks. */
export const SUBJECT = {
	PERSON: 'person',
	NAME: 'name',
	EVENT: 'event',
	UNION: 'union',
	LINK: 'parent_child',
	SOURCE: 'source',
	CITATION: 'citation',
	REPOSITORY: 'repository',
	NOTE: 'note'
} as const;

const INDIVIDUAL = 'INDIVIDUAL';
const FAMILY = 'FAMILY';

export function selectScope(whole: TreeRows, seed: ScopeSeed): TreeRows {
	const people = new Set<string>();
	const unions = new Set<string>();
	const events = new Set<string>();
	const names = new Set<string>();
	const links = new Set<string>();
	const media = new Set<string>();
	const citations = new Set<string>();
	const sources = new Set<string>();
	const repositories = new Set<string>();
	const notes = new Set<string>();
	const attachments = new Set<string>();
	const tasks = new Set<string>();

	const personById = new Map(whole.individuals.map((r) => [r.id, r]));
	const unionById = new Map(whole.unions.map((r) => [r.id, r]));
	const eventById = new Map(whole.events.map((r) => [r.id, r]));
	const nameById = new Map(whole.personNames.map((r) => [r.id, r]));
	const linkById = new Map(whole.parentChild.map((r) => [r.id, r]));
	const mediaById = new Map(whole.mediaItems.map((r) => [r.id, r]));
	const citationById = new Map(whole.citations.map((r) => [r.id, r]));
	const sourceIds = new Set(whole.sources.map((r) => r.id));
	const repositoryIds = new Set(whole.repositories.map((r) => r.id));
	const noteIds = new Set(whole.notes.map((r) => r.id));
	const attachmentById = new Map(whole.noteAttachments.map((r) => [r.id, r]));
	const taskById = new Map(whole.researchTasks.map((r) => [r.id, r]));
	const linkRowById = new Map(whole.sourceRepositories.map((r) => [r.id, r]));

	/** Adds a record by the kind a subject column names; an id the tree does not have adds nothing. */
	const addSubject = (kind: string | null, id: string | null) => {
		if (!kind || !id) return;
		switch (kind) {
			case SUBJECT.PERSON:
				if (personById.has(id)) people.add(id);
				break;
			case SUBJECT.NAME:
				if (nameById.has(id)) names.add(id);
				break;
			case SUBJECT.EVENT:
				if (eventById.has(id)) events.add(id);
				break;
			case SUBJECT.UNION:
				if (unionById.has(id)) unions.add(id);
				break;
			case SUBJECT.LINK:
				if (linkById.has(id)) links.add(id);
				break;
			case SUBJECT.SOURCE:
				if (sourceIds.has(id)) sources.add(id);
				break;
			case SUBJECT.CITATION:
				if (citationById.has(id)) citations.add(id);
				break;
			case SUBJECT.REPOSITORY:
				if (repositoryIds.has(id)) repositories.add(id);
				break;
			case SUBJECT.NOTE:
				if (noteIds.has(id)) notes.add(id);
				break;
		}
	};

	for (const id of seed.people) addSubject(SUBJECT.PERSON, id);
	for (const id of seed.unions) addSubject(SUBJECT.UNION, id);
	for (const id of seed.events) addSubject(SUBJECT.EVENT, id);
	for (const id of seed.names) addSubject(SUBJECT.NAME, id);
	for (const id of seed.links) addSubject(SUBJECT.LINK, id);
	for (const id of seed.citations) addSubject(SUBJECT.CITATION, id);
	for (const id of seed.sources) addSubject(SUBJECT.SOURCE, id);
	for (const id of seed.bareSources) addSubject(SUBJECT.SOURCE, id);
	for (const id of seed.repositories) addSubject(SUBJECT.REPOSITORY, id);
	for (const id of seed.notes) addSubject(SUBJECT.NOTE, id);
	for (const id of seed.media) if (mediaById.has(id)) media.add(id);
	for (const id of seed.noteAttachments) if (attachmentById.has(id)) attachments.add(id);
	for (const id of seed.tasks) if (taskById.has(id)) tasks.add(id);
	// A link resolves to its source and its repository and is itself selected, but pulls neither.
	const pulledRepositoryLinks = new Set<string>();
	for (const id of seed.sourceRepositories) {
		const link = linkRowById.get(id);
		if (!link) continue;
		pulledRepositoryLinks.add(id);
		addSubject(SUBJECT.SOURCE, link.sourceId);
		addSubject(SUBJECT.REPOSITORY, link.repositoryId);
	}

	// Pull: only what the caller seeded directly.
	for (const c of whole.citations)
		if (c.sourceId && seed.sources.has(c.sourceId)) citations.add(c.id);
	for (const a of whole.noteAttachments)
		if (a.noteId && seed.notes.has(a.noteId)) attachments.add(a.id);
	for (const l of whole.sourceRepositories)
		if (l.repositoryId && seed.repositories.has(l.repositoryId)) pulledRepositoryLinks.add(l.id);

	// Resolve to a fixed point: a note on a citation reaches the citation's subject on the next pass.
	const size = () =>
		people.size +
		unions.size +
		events.size +
		names.size +
		links.size +
		media.size +
		citations.size +
		sources.size +
		repositories.size +
		notes.size +
		attachments.size +
		tasks.size;
	for (let before = -1; before !== size();) {
		before = size();
		for (const id of [...events]) {
			const e = eventById.get(id)!;
			addSubject(e.entityType === FAMILY ? SUBJECT.UNION : SUBJECT.PERSON, e.entityId);
		}
		for (const id of [...names]) addSubject(SUBJECT.PERSON, nameById.get(id)!.personId);
		for (const id of [...links]) {
			const l = linkById.get(id)!;
			addSubject(SUBJECT.PERSON, l.parentId);
			addSubject(SUBJECT.PERSON, l.childId);
			addSubject(SUBJECT.UNION, l.unionId);
		}
		// A seeded file resolves the records it is linked to (a source link needs no row of its own here).
		for (const l of whole.mediaLinks)
			if (media.has(l.mediaId)) {
				addSubject(SUBJECT.PERSON, l.entityId);
				addSubject(SUBJECT.UNION, l.entityId);
			}
		for (const id of [...citations]) {
			const c = citationById.get(id)!;
			addSubject(c.subjectKind, c.subjectId);
			addSubject(SUBJECT.SOURCE, c.sourceId);
		}
		for (const id of [...attachments]) {
			const a = attachmentById.get(id)!;
			addSubject(a.subjectKind, a.subjectId);
			addSubject(SUBJECT.NOTE, a.noteId);
		}
		for (const id of [...tasks]) {
			const t = taskById.get(id)!;
			addSubject(t.subjectKind, t.subjectId);
		}
	}

	// People and partnerships.
	const resolvedPeople = new Set(people);
	for (const p of whole.unionPartners) if (resolvedPeople.has(p.personId)) unions.add(p.unionId);
	const partnerRows = whole.unionPartners.filter((p) => unions.has(p.unionId));
	const everyone = new Set(resolvedPeople);
	for (const p of partnerRows) if (personById.has(p.personId)) everyone.add(p.personId);

	// Links touching them, and the people at the other ends.
	const linkRows = whole.parentChild.filter(
		(l) =>
			everyone.has(l.parentId) ||
			everyone.has(l.childId) ||
			(l.unionId !== null && unions.has(l.unionId)) ||
			links.has(l.id)
	);
	for (const l of linkRows) {
		links.add(l.id);
		if (personById.has(l.parentId)) everyone.add(l.parentId);
		if (personById.has(l.childId)) everyone.add(l.childId);
	}

	const nameRows = whole.personNames.filter((n) => everyone.has(n.personId));
	const eventRows = whole.events.filter(
		(e) =>
			(e.entityType === INDIVIDUAL && everyone.has(e.entityId)) ||
			(e.entityType === FAMILY && unions.has(e.entityId)) ||
			events.has(e.id)
	);
	// Links of a seeded file, and links to anything loaded (a seeded source included); the files those
	// links name are loaded with them, but their other links are not.
	const fileLinkIds = new Set(
		whole.mediaLinks
			.filter(
				(l) =>
					media.has(l.mediaId) ||
					everyone.has(l.entityId) ||
					unions.has(l.entityId) ||
					seed.sources.has(l.entityId)
			)
			.map((l) => l.id)
	);
	const loadedMedia = new Set(media);
	for (const l of whole.mediaLinks)
		if (fileLinkIds.has(l.id) && mediaById.has(l.mediaId)) loadedMedia.add(l.mediaId);

	// What is attached to everything loaded so far. Names, events and links are now final.
	const loadedNames = new Set(nameRows.map((n) => n.id));
	const loadedEvents = new Set(eventRows.map((e) => e.id));
	const has = (kind: string, id: string) => {
		switch (kind) {
			case SUBJECT.PERSON:
				return everyone.has(id);
			case SUBJECT.NAME:
				return loadedNames.has(id);
			case SUBJECT.EVENT:
				return loadedEvents.has(id);
			case SUBJECT.UNION:
				return unions.has(id);
			case SUBJECT.LINK:
				return links.has(id);
			case SUBJECT.SOURCE:
				return sources.has(id);
			case SUBJECT.CITATION:
				return citations.has(id);
			case SUBJECT.REPOSITORY:
				return repositories.has(id);
			case SUBJECT.NOTE:
				return notes.has(id);
			default:
				return false;
		}
	};
	for (const c of whole.citations) if (has(c.subjectKind, c.subjectId)) citations.add(c.id);
	for (const id of citations) {
		const sourceId = citationById.get(id)!.sourceId;
		if (sourceId && sourceIds.has(sourceId)) sources.add(sourceId);
	}
	// Every loaded source brings its repository links and those repositories.
	for (const l of whole.sourceRepositories) {
		if (sources.has(l.sourceId)) {
			pulledRepositoryLinks.add(l.id);
			if (l.repositoryId && repositoryIds.has(l.repositoryId)) repositories.add(l.repositoryId);
		}
	}
	for (const a of whole.noteAttachments) {
		if (has(a.subjectKind, a.subjectId)) attachments.add(a.id);
	}
	for (const id of attachments) {
		const noteId = attachmentById.get(id)!.noteId;
		if (noteId && noteIds.has(noteId)) notes.add(noteId);
	}
	for (const t of whole.researchTasks)
		if (t.subjectKind && t.subjectId && has(t.subjectKind, t.subjectId)) tasks.add(t.id);
	const subtreeIds = new Set(seed.subtrees);
	for (const s of whole.subtrees) if (resolvedPeople.has(s.rootPersonId)) subtreeIds.add(s.id);

	const isWhole = (table: keyof TreeRows) => seed.wholeTables?.includes(table) ?? false;
	const pick = <T extends { id: string }>(
		table: keyof TreeRows,
		rows: T[],
		test: (row: T) => boolean
	): T[] => (isWhole(table) ? rows : rows.filter(test));

	return {
		individuals: pick('individuals', whole.individuals, (r) => everyone.has(r.id)),
		personNames: pick('personNames', whole.personNames, (r) => everyone.has(r.personId)),
		unions: pick('unions', whole.unions, (r) => unions.has(r.id)),
		unionPartners: pick('unionPartners', whole.unionPartners, (r) => unions.has(r.unionId)),
		parentChild: pick('parentChild', whole.parentChild, (r) => links.has(r.id)),
		events: pick('events', whole.events, (r) => loadedEvents.has(r.id)),
		mediaItems: pick('mediaItems', whole.mediaItems, (r) => loadedMedia.has(r.id)),
		mediaLinks: pick('mediaLinks', whole.mediaLinks, (r) => fileLinkIds.has(r.id)),
		sources: pick('sources', whole.sources, (r) => sources.has(r.id)),
		repositories: pick('repositories', whole.repositories, (r) => repositories.has(r.id)),
		sourceRepositories: pick('sourceRepositories', whole.sourceRepositories, (r) =>
			pulledRepositoryLinks.has(r.id)
		),
		citations: pick('citations', whole.citations, (r) => citations.has(r.id)),
		notes: pick('notes', whole.notes, (r) => notes.has(r.id)),
		noteAttachments: pick('noteAttachments', whole.noteAttachments, (r) => attachments.has(r.id)),
		researchTasks: pick('researchTasks', whole.researchTasks, (r) => tasks.has(r.id)),
		subtrees: pick('subtrees', whole.subtrees, (r) => subtreeIds.has(r.id))
	};
}
