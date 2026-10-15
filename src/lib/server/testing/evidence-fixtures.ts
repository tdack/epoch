/**
 * Evidence the GEDCOM fixtures lack, spread over a tree so scoped-snapshot tests (ADR-055) have
 * cascades to run: sources and repositories (some shared), citations and notes on every kind of
 * subject including partnerships and links, tasks, and files. Deterministic for a given `random`.
 */

import type { DbClient } from '../db';
import {
	citations,
	mediaItems,
	noteAttachments,
	notes,
	repositories,
	researchTasks,
	sourceRepositories,
	sources
} from '../db/schema';
import type { TreeRows } from '../domain/change-log';

/** A small deterministic generator, so the draws are the same on every run. */
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let n = state;
		n = Math.imul(n ^ (n >>> 15), n | 1);
		n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
		return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
	};
}

export async function addEvidence(
	db: DbClient,
	treeId: string,
	rows: TreeRows,
	random: () => number
): Promise<void> {
	const prefix = treeId.slice(0, 8);
	const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
	const hasEvents = rows.events.length > 0;
	const sourceIds = ['a', 'b', 'c', 'd'].map((s) => `${prefix}-src-${s}`);
	const repositoryIds = ['a', 'b'].map((s) => `${prefix}-repo-${s}`);
	const noteIds = ['a', 'b', 'c'].map((s) => `${prefix}-note-${s}`);
	await db.insert(sources).values(sourceIds.map((id) => ({ id, treeId, title: id, version: 1 })));
	await db
		.insert(repositories)
		.values(repositoryIds.map((id) => ({ id, treeId, name: id, version: 1 })));
	await db.insert(sourceRepositories).values([
		{ id: `${prefix}-sr-1`, sourceId: sourceIds[0]!, repositoryId: repositoryIds[0]! },
		{ id: `${prefix}-sr-2`, sourceId: sourceIds[1]!, repositoryId: repositoryIds[0]! },
		{ id: `${prefix}-sr-3`, sourceId: sourceIds[2]!, repositoryId: repositoryIds[1]! }
	]);
	await db.insert(notes).values(noteIds.map((id) => ({ id, treeId, text: id, version: 1 })));

	const subjects: Array<['person' | 'name' | 'event' | 'union' | 'parent_child', string]> = [];
	for (let i = 0; i < 60; i++) {
		subjects.push(['person', pick(rows.individuals).id]);
		subjects.push(['name', pick(rows.personNames).id]);
		if (hasEvents) subjects.push(['event', pick(rows.events).id]);
		if (rows.unions.length > 0) {
			// Twice: partnerships and links are what the union kinds cascade through.
			subjects.push(['union', pick(rows.unions).id]);
			subjects.push(['union', pick(rows.unions).id]);
		}
		if (rows.parentChild.length > 0) {
			subjects.push(['parent_child', pick(rows.parentChild).id]);
			subjects.push(['parent_child', pick(rows.parentChild).id]);
		}
	}
	const citationIds: string[] = [];
	for (const [index, [subjectKind, subjectId]] of subjects.entries()) {
		const id = `${prefix}-cite-${index}`;
		citationIds.push(id);
		await db.insert(citations).values({
			id,
			treeId,
			subjectKind,
			subjectId,
			sortOrder: index,
			sourceId: random() < 0.85 ? pick(sourceIds) : null,
			page: `p${index}`,
			version: 1
		});
	}
	let attachmentIndex = 0;
	const attach = async (
		subjectKind:
			'person' | 'event' | 'union' | 'parent_child' | 'citation' | 'source' | 'repository',
		subjectId: string,
		noteId: string | null
	) =>
		db.insert(noteAttachments).values({
			id: `${prefix}-att-${attachmentIndex++}`,
			treeId,
			subjectKind,
			subjectId,
			sortOrder: attachmentIndex,
			noteId,
			text: noteId ? null : 'inline',
			version: 1
		});
	for (let i = 0; i < 40; i++) {
		await attach('person', pick(rows.individuals).id, random() < 0.5 ? pick(noteIds) : null);
		if (hasEvents)
			await attach('event', pick(rows.events).id, random() < 0.5 ? pick(noteIds) : null);
		if (rows.unions.length > 0)
			await attach('union', pick(rows.unions).id, random() < 0.5 ? pick(noteIds) : null);
		if (rows.parentChild.length > 0)
			await attach(
				'parent_child',
				pick(rows.parentChild).id,
				random() < 0.5 ? pick(noteIds) : null
			);
	}
	for (let i = 0; i < 10; i++) {
		await attach('citation', pick(citationIds), random() < 0.5 ? pick(noteIds) : null);
		await attach('source', pick(sourceIds), random() < 0.5 ? pick(noteIds) : null);
	}
	await attach('repository', pick(repositoryIds), pick(noteIds));

	const tasksOf: Array<['person' | 'union' | 'event' | 'source' | 'note' | null, string | null]> = [
		[null, null]
	];
	for (let i = 0; i < 30; i++) {
		tasksOf.push(['person', pick(rows.individuals).id]);
		if (hasEvents) tasksOf.push(['event', pick(rows.events).id]);
		if (rows.unions.length > 0) tasksOf.push(['union', pick(rows.unions).id]);
	}
	for (let i = 0; i < 5; i++) {
		tasksOf.push(['source', pick(sourceIds)]);
		tasksOf.push(['note', pick(noteIds)]);
	}
	for (const [index, [subjectKind, subjectId]] of tasksOf.entries()) {
		await db.insert(researchTasks).values({
			id: `${prefix}-task-${index}`,
			treeId,
			title: `task ${index}`,
			subjectKind,
			subjectId,
			version: 1
		});
	}
	for (let i = 0; i < 12; i++) {
		const owner =
			i % 4 === 0 && rows.unions.length > 0 ? pick(rows.unions) : pick(rows.individuals);
		await db.insert(mediaItems).values({
			id: `${prefix}-media-${i}`,
			treeId,
			entityId: i % 6 === 5 ? null : owner.id,
			r2ObjectKey: `media/${treeId}/${i}.png`,
			mimeType: 'image/png',
			version: 1
		});
	}
}
