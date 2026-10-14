import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TreeRows } from '../domain/change-log';
import type { RecordChange } from '../../shared/impact';
import { mediaItems } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { wholeGraph } from '../testing/graph';
import { ChangeLogService } from './change-log-service';
import { PersonService } from './person-service';
import { RelationshipService, type MergeUnionsCommand } from './relationship-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

/**
 * Homer and Marge with three partnerships as an import of a dirty file leaves them: imported
 * XREF ids, a child in each of the first two, and a marriage on the first two.
 */
async function setup(options: { marriages?: [string | null, string | null, string | null] } = {}) {
	const actor = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, actor);
	const relationships = new RelationshipService(t.db);
	const people = new PersonService(t.db);
	const log = new ChangeLogService(t.db);
	const ctx = actor.context;

	const add = async (givenName: string) =>
		(await people.create(treeId, { givenName, surname: 'Simpson' }, ctx)).individual;
	const [homer, marge, bart, lisa] = [
		await add('Homer'),
		await add('Marge'),
		await add('Bart'),
		await add('Lisa')
	];

	const unionIds = [1, 2, 3].map((n) => `${treeId}:@F${n}@`);
	await relationships.runner.run(treeId, ctx, {
		kind: 'create_union',
		summary: () => 'Imported',
		commands: unionIds.map((unionId) => ({
			kind: 'create_union' as const,
			unionId,
			personIds: [homer.id, marge.id]
		}))
	});
	const link = (childId: string, unionId: string) =>
		relationships.runner.run(treeId, ctx, {
			kind: 'assert_parent_child',
			summary: () => 'Linked',
			commands: [homer, marge].map((parent) => ({
				kind: 'assert_parent_child' as const,
				parentId: parent.id,
				childId,
				type: 'biological' as const,
				unionId
			}))
		});
	await link(bart.id, unionIds[0]);
	await link(lisa.id, unionIds[1]);

	const marriages = options.marriages ?? ['3 Nov 2014', '3 Nov 2014', null];
	for (const [index, date] of marriages.entries()) {
		if (!date) continue;
		await setMarriage(unionIds[index], date, 'Perth');
	}

	async function setMarriage(unionId: string, dateText: string, place: string | null) {
		const union = (await wholeGraph(t.db, treeId, ctx)).unions.find((u) => u.id === unionId)!;
		const existing = union.events?.find((e) => e.type === 'MARR');
		await relationships.updateUnion(
			treeId,
			{
				kind: 'update_union',
				unionId,
				expectedVersion: union.version!,
				events: [{ id: existing?.id ?? null, type: 'MARR', dateText, place }]
			},
			ctx
		);
	}

	const rows = (): Promise<TreeRows> => relationships.runner.store.loadRows(treeId);
	const command = async (
		overrides: Partial<MergeUnionsCommand> = {}
	): Promise<MergeUnionsCommand> => {
		const graph = await wholeGraph(t.db, treeId, ctx);
		return {
			kind: 'merge_unions',
			survivorId: unionIds[0],
			mergedIds: [unionIds[1], unionIds[2]],
			expectedVersions: Object.fromEntries(graph.unions.map((u) => [u.id, u.version!])),
			...overrides
		};
	};
	return {
		actor,
		treeId,
		relationships,
		log,
		ctx,
		homer,
		marge,
		bart,
		lisa,
		unionIds,
		rows,
		command,
		setMarriage
	};
}

/** Every row of the tree, without the fields any write moves, in a stable order. */
function canonical(rows: TreeRows) {
	const strip = (row: Record<string, unknown>) => {
		const { version: _v, updatedAt: _u, ...rest } = row;
		return rest;
	};
	return Object.fromEntries(
		Object.entries(rows).map(([table, list]) => [
			table,
			(list as Array<Record<string, unknown>>)
				.map(strip)
				.sort((a, b) => String(a.id).localeCompare(String(b.id)))
		])
	);
}

const shape = (records: RecordChange[]) =>
	records.map((r) => `${r.action} ${r.entityType} ${r.label}`).sort();

describe('merging partnerships between the same people', () => {
	it('moves links and events onto the survivor, deletes the others and keeps every XREF as an alias', async () => {
		const s = await setup();
		await s.relationships.mergeUnions(s.treeId, await s.command(), s.ctx);

		const rows = await s.rows();
		expect(rows.unions.map((u) => u.id)).toEqual([s.unionIds[0]]);
		expect(rows.unions[0].xrefAliases).toEqual(['@F2@', '@F3@']);
		expect(rows.unionPartners.filter((p) => p.unionId === s.unionIds[0])).toHaveLength(2);
		expect(rows.unionPartners).toHaveLength(2);
		// Four links (two children, two parents each), all regrouped under the survivor.
		expect(rows.parentChild).toHaveLength(4);
		expect(rows.parentChild.every((l) => l.unionId === s.unionIds[0])).toBe(true);
		// The two identical marriages became one.
		const marriages = rows.events.filter((e) => e.entityType === 'FAMILY');
		expect(marriages.map((e) => [e.entityId, e.type, e.dateRaw])).toEqual([
			[s.unionIds[0], 'MARR', '3 Nov 2014']
		]);
	});

	it('carries aliases transitively when a union that was itself a survivor is merged', async () => {
		const s = await setup();
		await s.relationships.mergeUnions(
			s.treeId,
			await s.command({ mergedIds: [s.unionIds[1]] }),
			s.ctx
		);
		await s.relationships.mergeUnions(
			s.treeId,
			await s.command({ survivorId: s.unionIds[2], mergedIds: [s.unionIds[0]] }),
			s.ctx
		);
		const [only] = (await s.rows()).unions;
		expect(only.id).toBe(s.unionIds[2]);
		expect(only.xrefAliases).toEqual(['@F1@', '@F2@']);
	});

	it('previews exactly the records the merge writes, and names which partnership each moves from and to', async () => {
		const s = await setup();
		const command = await s.command();
		const { conflicts, impact } = await s.relationships.previewMerge(s.treeId, command, s.ctx);
		expect(conflicts).toEqual([]);
		const executed = await s.relationships.mergeUnions(s.treeId, command, s.ctx);
		expect(shape(impact!.records)).toEqual(shape(executed.affected));
		expect(impact!.isDestructive).toBe(true);

		// The two Homer–Marge partnerships share a name, so the labels carry the chronology.
		const deletedUnions = impact!.records
			.filter((r) => r.entityType === 'union' && r.action === 'deleted')
			.map((r) => r.label);
		expect(deletedUnions).toHaveLength(2);
		expect(new Set(deletedUnions).size).toBe(2);
		expect(
			deletedUnions.every((label) =>
				/Homer Simpson–Marge Simpson partnership \(\d(st|nd|rd) of 3/.test(label)
			)
		).toBe(true);

		// The child moved out of the second partnership is listed as a move.
		expect(impact!.moves.length).toBeGreaterThan(0);
		const lisaMoves = impact!.moves.filter((m) => m.label.includes('Lisa'));
		expect(lisaMoves).toHaveLength(2);
		expect(lisaMoves[0].from).not.toBe(lisaMoves[0].to);
	});

	it('undo restores every moved, deleted and updated row', async () => {
		const s = await setup();
		const before = canonical(await s.rows());
		await s.relationships.mergeUnions(s.treeId, await s.command(), s.ctx);
		expect(canonical(await s.rows())).not.toEqual(before);

		const undone = await s.log.undoLast(s.treeId, s.ctx);
		expect(undone.undone.summary).toMatch(/^Merged 3 partnerships/);
		expect(canonical(await s.rows())).toEqual(before);
	});

	it('moves a file of a merged partnership onto the survivor, and undo puts it back', async () => {
		const s = await setup();
		await t.db.insert(mediaItems).values({
			id: 'file-of-merged',
			treeId: s.treeId,
			entityId: s.unionIds[1],
			r2ObjectKey: `media/${s.treeId}/file-of-merged.png`,
			title: 'Wedding.png',
			mimeType: 'image/png',
			sizeBytes: 7,
			uploadedBy: s.actor.userId,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		});
		const file = () =>
			t.db.select().from(mediaItems).where(eq(mediaItems.id, 'file-of-merged')).get();

		const command = await s.command();
		// The file's owner is a partnership, so its preview names the partnership, not an unknown record.
		const { impact } = await s.relationships.previewMerge(s.treeId, command, s.ctx);
		const fileChange = impact!.records.find((r) => r.entityType === 'media');
		expect(fileChange?.label).toMatch(/^Attachment of Homer Simpson–Marge Simpson partnership/);

		await s.relationships.mergeUnions(s.treeId, command, s.ctx);
		expect(await file()).toMatchObject({ entityId: s.unionIds[0], version: 2, sizeBytes: 7 });

		await s.log.undoLast(s.treeId, s.ctx);
		expect(await file()).toMatchObject({ entityId: s.unionIds[1], version: 3, sizeBytes: 7 });
	});

	it('never merges two different marriage dates on its own: the preview and the command both refuse', async () => {
		const s = await setup({ marriages: ['1975', '1980', null] });
		const command = await s.command();

		const preview = await s.relationships.previewMerge(s.treeId, command, s.ctx);
		expect(preview.impact).toBeNull();
		expect(preview.conflicts).toMatchObject([{ kind: 'event', eventType: 'MARR' }]);

		await expect(s.relationships.mergeUnions(s.treeId, command, s.ctx)).rejects.toMatchObject({
			status: 409,
			code: 'UNION_MERGE_CONFLICT',
			details: { conflicts: [{ kind: 'event', eventType: 'MARR' }] }
		});
		expect((await s.rows()).unions).toHaveLength(3);
	});

	it('keeps the chosen marriage, deletes the other, and undo brings it back', async () => {
		const s = await setup({ marriages: ['1975', '1980', null] });
		const before = canonical(await s.rows());
		const command = await s.command({ keep: { events: { MARR: s.unionIds[1] } } });

		const { impact } = await s.relationships.previewMerge(s.treeId, command, s.ctx);
		expect(impact).not.toBeNull();
		await s.relationships.mergeUnions(s.treeId, command, s.ctx);

		const marriages = (await s.rows()).events.filter((e) => e.type === 'MARR');
		expect(marriages.map((e) => [e.entityId, e.dateRaw])).toEqual([[s.unionIds[0], '1980']]);

		await s.log.undoLast(s.treeId, s.ctx);
		expect(canonical(await s.rows())).toEqual(before);
	});

	it('refuses a choice that names a union with nothing to keep', async () => {
		const s = await setup({ marriages: ['1975', '1980', null] });
		const command = await s.command({ keep: { events: { MARR: s.unionIds[2] } } });
		await expect(s.relationships.mergeUnions(s.treeId, command, s.ctx)).rejects.toMatchObject({
			code: 'UNION_MERGE_CONFLICT'
		});
	});

	it('treats differing statuses as a conflict that needs a choice, and applies it', async () => {
		const s = await setup({ marriages: [null, null, null] });
		const graph = await wholeGraph(t.db, s.treeId, s.ctx);
		const second = graph.unions.find((u) => u.id === s.unionIds[1])!;
		await s.relationships.updateUnion(
			s.treeId,
			{
				kind: 'update_union',
				unionId: second.id,
				expectedVersion: second.version!,
				status: 'divorced'
			},
			s.ctx
		);

		const open = await s.relationships.previewMerge(s.treeId, await s.command(), s.ctx);
		expect(open.impact).toBeNull();
		expect(open.conflicts).toMatchObject([{ kind: 'status' }]);

		await s.relationships.mergeUnions(
			s.treeId,
			await s.command({ keep: { status: s.unionIds[1] } }),
			s.ctx
		);
		expect((await s.rows()).unions.map((u) => u.status)).toEqual(['divorced']);
	});

	it('fills a gap instead of calling it a conflict: a marriage on one side only is kept', async () => {
		const s = await setup({ marriages: [null, '1975', null] });
		await s.relationships.mergeUnions(s.treeId, await s.command(), s.ctx);
		const marriages = (await s.rows()).events.filter((e) => e.type === 'MARR');
		expect(marriages.map((e) => [e.entityId, e.dateRaw])).toEqual([[s.unionIds[0], '1975']]);
	});

	it('refuses to merge partnerships between different people', async () => {
		const s = await setup();
		const other = (await new PersonService(t.db).create(s.treeId, { givenName: 'Sam' }, s.ctx))
			.individual;
		const strange = crypto.randomUUID();
		await s.relationships.runner.run(s.treeId, s.ctx, {
			kind: 'create_union',
			summary: () => 'Added',
			commands: [{ kind: 'create_union', unionId: strange, personIds: [s.homer.id, other.id] }]
		});
		await expect(
			s.relationships.mergeUnions(s.treeId, { ...(await s.command()), mergedIds: [strange] }, s.ctx)
		).rejects.toMatchObject({ status: 400 });
	});

	it('is a stale-version conflict when a partnership changed after the dialog loaded it', async () => {
		const s = await setup();
		const command = await s.command();
		await s.setMarriage(s.unionIds[2], '1990', null);
		await expect(s.relationships.mergeUnions(s.treeId, command, s.ctx)).rejects.toMatchObject({
			status: 409,
			details: { reason: 'STALE_VERSION' }
		});
		expect((await s.rows()).unions).toHaveLength(3);
	});

	it('needs the right to delete: a viewer is refused, and nothing changes', async () => {
		const s = await setup();
		const viewer = await createTestUser(t.db, 'viewer');
		await addTestMember(t.db, s.treeId, viewer, 'viewer');
		await expect(
			s.relationships.mergeUnions(s.treeId, await s.command(), viewer.context)
		).rejects.toMatchObject({ status: 403 });
		expect((await s.rows()).unions).toHaveLength(3);
	});

	it('undoes newest first: the child linked to the merged partnership, the person, then the merge', async () => {
		const s = await setup();
		await s.relationships.mergeUnions(s.treeId, await s.command(), s.ctx);
		const extra = (await new PersonService(t.db).create(s.treeId, { givenName: 'Ash' }, s.ctx))
			.individual;
		await s.relationships.execute(
			s.treeId,
			{
				kind: 'add_child',
				parent: { id: s.homer.id, givenName: 'Homer', surname: 'Simpson' },
				child: { id: extra.id, givenName: 'Ash', surname: null },
				type: 'biological',
				unionLabel: null
			},
			s.ctx
		);
		expect((await s.log.undoLast(s.treeId, s.ctx)).undone.summary).toMatch(/Ash/);
		expect((await s.log.undoLast(s.treeId, s.ctx)).undone.summary).toBe('Added Ash');
		expect((await s.log.undoLast(s.treeId, s.ctx)).undone.summary).toMatch(
			/^Merged 3 partnerships/
		);
		expect((await s.rows()).unions).toHaveLength(3);
	});
});
