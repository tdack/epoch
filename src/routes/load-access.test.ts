/**
 * Who each server load lets in, run against the real loads and a real database. A load repeats the
 * access settings of the endpoint it replaced (ADR-067), and nothing else ties the two together, so
 * this table fails when one drifts: the visitor, a role that is too low, a tree that is not there,
 * and the sub-tree lens each read is scoped by.
 */

import { isHttpError, isRedirect, type ServerLoadEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { trees } from '#lib/server/db/schema/index.js';
import { PUBLIC_VISITOR, type UserIdentity } from '#lib/server/domain/identity.js';
import { GraphQueryService } from '#lib/server/services/graph-query-service.js';
import { ListService } from '#lib/server/services/list-service.js';
import { PersonPageService } from '#lib/server/services/person-page-service.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { PublicTreeService } from '#lib/server/services/public-tree-service.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { SearchService } from '#lib/server/services/search-service.js';
import { SubtreeService } from '#lib/server/services/subtree-service.js';
import { importGedcomToDb } from '#lib/server/testing/gedcom.js';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';

type Load = (event: ServerLoadEvent) => Promise<unknown>;
interface LoadModule {
	load: Load;
}

/**
 * How the public visitor fares, copied from the endpoints the loads replaced (`git show
 * main:src/routes/api/...`): `open` where the endpoint set `allowPublicVisitor`, `closed` where it
 * did not, and `not-theirs` where the page is a 404 for the visitor before it reads anything.
 */
type Visitor = 'open' | 'closed' | 'not-theirs';
/** `manager` or `editor` where the service needs more than a viewer (`tree:manage_members`, `record:edit`). */
type Needs = 'viewer' | 'editor' | 'manager';

interface Expected {
	visitor: Visitor;
	needs: Needs;
	/** A caller below `needs` is sent elsewhere with a 302 instead of refused with a 403. */
	isRedirectedBelow?: true;
	/** Whether the address names a tree. The three redirect pages at the root do not. */
	isTree: boolean;
}

const TREE: Expected = { visitor: 'open', needs: 'viewer', isTree: true };
const CLOSED: Expected = { visitor: 'closed', needs: 'viewer', isTree: true };
const EDITOR: Expected = { visitor: 'closed', needs: 'editor', isTree: true };
const MANAGER: Expected = { visitor: 'closed', needs: 'manager', isTree: true };
const NOT_THEIRS: Expected = { visitor: 'not-theirs', needs: 'viewer', isTree: true };
// Tree settings: an old bookmark of the personal colours that lived here goes to the account.
const SETTINGS: Expected = { ...NOT_THEIRS, needs: 'manager', isRedirectedBelow: true };
const ROOT: Expected = { visitor: 'open', needs: 'viewer', isTree: false };

const EXPECTED: Record<string, Expected> = {
	'./+page.server.ts': ROOT,
	'./manage/trees/+page.server.ts': { ...ROOT, visitor: 'closed' },
	'./settings/+page.server.ts': { ...ROOT, visitor: 'closed' },
	'./profile/+page.server.ts': { ...ROOT, visitor: 'closed' },
	'./(app)/account/+page.server.ts': { ...ROOT, visitor: 'closed' },
	'./(app)/admin/+page.server.ts': { ...ROOT, visitor: 'closed' },
	'./trees/[id]/profile/+page.server.ts': CLOSED,
	'./trees/[id]/+layout.server.ts': TREE,
	'./trees/[id]/people/+page.server.ts': TREE,
	'./trees/[id]/surnames/+page.server.ts': TREE,
	'./trees/[id]/unions/+page.server.ts': TREE,
	'./trees/[id]/places/+page.server.ts': TREE,
	'./trees/[id]/place/+page.server.ts': TREE,
	'./trees/[id]/people/[personId]/+page.server.ts': TREE,
	'./trees/[id]/people/[personId]/descendants/+page.server.ts': TREE,
	'./trees/[id]/people/[personId]/fan/+page.server.ts': TREE,
	'./trees/[id]/people/[personId]/hourglass/+page.server.ts': TREE,
	'./trees/[id]/people/[personId]/pedigree/+page.server.ts': TREE,
	'./trees/[id]/relationship/+page.server.ts': TREE,
	'./trees/[id]/search/+page.server.ts': TREE,
	'./trees/[id]/unions/[unionId]/+page.server.ts': TREE,
	'./trees/[id]/notes/+page.server.ts': TREE,
	'./trees/[id]/notes/[noteId]/+page.server.ts': TREE,
	'./trees/[id]/sources/+page.server.ts': TREE,
	'./trees/[id]/sources/[sourceId]/+page.server.ts': TREE,
	'./trees/[id]/tasks/+page.server.ts': CLOSED,
	'./trees/[id]/quality/+page.server.ts': CLOSED,
	'./trees/[id]/audit/+page.server.ts': EDITOR,
	'./trees/[id]/members/+page.server.ts': MANAGER,
	// Only redirects to Tree settings, for every member.
	'./trees/[id]/privacy/+page.server.ts': CLOSED,
	'./trees/[id]/files/+page.server.ts': NOT_THEIRS,
	'./trees/[id]/settings/+page.server.ts': SETTINGS,
	'./trees/[id]/trees/+page.server.ts': NOT_THEIRS
};

/** Loads that read no tree and no person: the app's own details and the sign-in pages. */
const NOT_ABOUT_A_TREE = [
	'./+layout.server.ts',
	'./(app)/+layout.server.ts',
	'./login/+page.server.ts',
	'./welcome/+page.server.ts'
];

const modules = import.meta.glob<LoadModule>(['./**/+page.server.ts', './**/+layout.server.ts'], {
	eager: true
});
const LAYOUT = './trees/[id]/+layout.server.ts';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Rex /Alpha/
1 FAMS @F1@
0 @I2@ INDI
1 NAME Cleo /Alpha/
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
0 TRLR`;

let t: TestDatabase;
let owner: TestActor;
let privateId: string;
let publicId: string;
const people: Record<string, UserIdentity> = {};

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	const [viewer, editor, manager, stranger] = await Promise.all(
		['viewer', 'editor', 'manager', 'stranger'].map((label) => createTestUser(t.db, label))
	);
	privateId = await createTestTree(t.db, owner);
	publicId = await createTestTree(t.db, owner);
	for (const id of [privateId, publicId]) await importGedcomToDb(t.d1, id, FIXTURE, 'Access');
	await addTestMember(t.db, privateId, viewer!, 'viewer');
	await addTestMember(t.db, privateId, editor!, 'editor');
	await addTestMember(t.db, privateId, manager!, 'manager');
	const installOwner = { ...owner.context.user, isInstallOwner: true };
	const name = (await t.db
		.select({ name: trees.name })
		.from(trees)
		.where(eq(trees.id, publicId))
		.get())!.name;
	await new PublicTreeService(t.db).setPublicTree(publicId, name, {
		...owner.context,
		user: installOwner
	});
	await new SubtreeService(t.db).create(
		privateId,
		{ name: 'Rex line', slug: 'rex-line', rootPersonId: `${privateId}:@I1@` },
		owner.context
	);
	Object.assign(people, {
		owner: installOwner,
		viewer: viewer!.context.user,
		editor: editor!.context.user,
		manager: manager!.context.user,
		stranger: stranger!.context.user
	});
}, 60_000);
afterAll(async () => {
	await t.dispose();
});
afterEach(() => vi.restoreAllMocks());

/** Loads that read nothing until the address asks for something; the others read on arrival. */
const QUESTION: Record<string, string> = {
	'./trees/[id]/relationship/+page.server.ts': '?from=a&to=b',
	'./trees/[id]/search/+page.server.ts': '?q=Rex'
};

/** The address's dynamic parts, filled with people and records of the tree it names. */
function paramsFor(route: string, treeId: string, segment = treeId): Record<string, string> {
	const params: Record<string, string> = { id: segment };
	if (route.includes('[personId]')) params.personId = `${treeId}:@I1@`;
	if (route.includes('[unionId]')) params.unionId = 'no-such-union';
	if (route.includes('[noteId]')) params.noteId = 'no-such-note';
	if (route.includes('[sourceId]')) params.sourceId = 'no-such-source';
	return params;
}

function eventFor(
	route: string,
	user: UserIdentity | null,
	params: Record<string, string>,
	search = ''
): ServerLoadEvent {
	const event = {
		locals: { user, correlationId: 'c1' },
		platform: {
			env: { DB: t.d1, MEDIA_BUCKET: { list: async () => ({ objects: [], truncated: false }) } }
		},
		params,
		url: new URL(`https://epoch.test/x${search}`),
		route: { id: route },
		depends: vi.fn()
	} as unknown as ServerLoadEvent;
	// What SvelteKit hands a page load: the layout's data, or the layout's own failure.
	(event as { parent: () => Promise<unknown> }).parent = () => modules[LAYOUT]!.load(event);
	return event;
}

/** What a load did, as a status: 200 for data, the redirect's or error's own otherwise. */
async function statusOf(
	route: string,
	user: UserIdentity | null,
	params: Record<string, string>,
	search = QUESTION[route] ?? ''
): Promise<{ status: number; message?: string }> {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	try {
		await modules[route]!.load(eventFor(route, user, params, search));
		return { status: 200 };
	} catch (cause) {
		if (isRedirect(cause)) return { status: cause.status };
		if (isHttpError(cause)) return { status: cause.status, message: cause.body.message };
		throw cause;
	}
}

const loads = Object.entries(EXPECTED);

describe('the table covers every server load', () => {
	it('names each load on disk, and none that is gone', () => {
		const onDisk = Object.keys(modules).filter((r) => !NOT_ABOUT_A_TREE.includes(r));
		expect(Object.keys(EXPECTED).sort()).toEqual(onDisk.sort());
	});
});

describe.each(loads)('%s', (route, expected) => {
	const treeId = () => (expected.isTree ? privateId : '');

	it('refuses a signed-out caller with a 401', async () => {
		expect((await statusOf(route, null, paramsFor(route, treeId()))).status).toBe(401);
	});

	it('answers the public visitor on the public tree as the endpoint did', async () => {
		// A service may refuse the visitor on its own, so the status alone cannot tell a load that
		// closed the gate from one that left it open: whether the gate let the visitor reach a read
		// is seen in the first thing a load does after it (the tree lookup, or the tree list).
		const reached = expected.isTree
			? vi.spyOn(PublicTreeService.prototype, 'current')
			: vi.spyOn(TreeService.prototype, 'listTrees');
		const { status, message } = await statusOf(route, PUBLIC_VISITOR, paramsFor(route, publicId));
		if (expected.visitor === 'closed') {
			expect(status).toBe(403);
			expect(reached).not.toHaveBeenCalled();
		} else {
			expect(reached).toHaveBeenCalled();
			if (expected.visitor === 'not-theirs') expect([status, message]).toEqual([404, 'Not found']);
			else expect([401, 403]).not.toContain(status);
		}
	});

	it.runIf(expected.isTree)(
		'refuses the visitor a tree that is not the public one, as it refuses an unknown one',
		async () => {
			const other = await statusOf(route, PUBLIC_VISITOR, paramsFor(route, privateId));
			const unknown = await statusOf(route, PUBLIC_VISITOR, paramsFor(route, 'x', 'no-such-tree'));
			expect(other.status).toBe(403);
			expect(unknown).toEqual(other);
		}
	);

	it.runIf(expected.isTree)('gives a stranger, and an unknown tree, nothing', async () => {
		const stranger = await statusOf(route, people.stranger!, paramsFor(route, privateId));
		const unknown = await statusOf(route, people.owner!, paramsFor(route, 'x', 'no-such-tree'));
		expect([403, 404]).toContain(stranger.status);
		expect([403, 404]).toContain(unknown.status);
	});

	it.runIf(expected.isTree)('refuses an address whose sub-tree does not exist', async () => {
		const { status } = await statusOf(
			route,
			people.owner!,
			paramsFor(route, privateId, `${privateId}~no-such-line`)
		);
		expect(status).toBe(404);
	});

	it.runIf(expected.isTree)('asks for the role the service needs, and no more', async () => {
		const refusal = expected.isRedirectedBelow ? 302 : 403;
		const isRefused = async (who: string) =>
			(await statusOf(route, people[who]!, paramsFor(route, privateId))).status === refusal;
		if (expected.needs === 'editor') {
			expect(await isRefused('viewer')).toBe(true);
			expect(await isRefused('editor')).toBe(false);
		} else if (expected.needs === 'manager') {
			expect(await isRefused('viewer')).toBe(true);
			expect(await isRefused('editor')).toBe(true);
			expect(await isRefused('manager')).toBe(false);
		} else {
			expect(await isRefused('viewer')).toBe(false);
		}
		expect(await isRefused('owner')).toBe(false);
	});
});

/** Reads the sub-tree lens scopes: the load must hand the service the lens's root, as the endpoint did. */
const LENS_READS: Array<[string, object, string, (args: unknown[]) => unknown, string]> = [
	['./trees/[id]/people/+page.server.ts', ListService.prototype, 'individuals', (a) => a[3], ''],
	['./trees/[id]/surnames/+page.server.ts', ListService.prototype, 'surnames', (a) => a[3], ''],
	['./trees/[id]/unions/+page.server.ts', ListService.prototype, 'unions', (a) => a[3], ''],
	['./trees/[id]/places/+page.server.ts', PlaceService.prototype, 'list', (a) => a[3], ''],
	[
		'./trees/[id]/place/+page.server.ts',
		PlaceService.prototype,
		'detail',
		(a) => a[4],
		'?name=Hobart'
	],
	[
		'./trees/[id]/people/[personId]/+page.server.ts',
		PersonPageService.prototype,
		'getPerson',
		(a) => a[3],
		''
	],
	['./trees/[id]/search/+page.server.ts', SearchService.prototype, 'search', (a) => a[3], '?q=Rex'],
	[
		LAYOUT,
		GraphQueryService.prototype,
		'summary',
		(a) => (a[2] as { rootPersonId: string } | null)?.rootPersonId,
		''
	]
];

describe.each(LENS_READS)('%s: the sub-tree lens', (route, prototype, method, rootOf, search) => {
	it(`hands ${method} the lens's root person, and null without one`, async () => {
		// What the services answer is not under test; only what the load asked them.
		const spy = vi.spyOn(prototype as Record<string, () => unknown>, method);
		spy.mockResolvedValue({ tree: {}, subtree: null, person: {} });
		const run = (segment: string) =>
			statusOf(route, people.owner!, paramsFor(route, privateId, segment), search);
		await run(`${privateId}~rex-line`);
		expect(rootOf(spy.mock.calls.at(-1) as unknown[])).toBe(`${privateId}:@I1@`);
		spy.mockClear();
		await run(privateId);
		expect(rootOf(spy.mock.calls.at(-1) as unknown[]) ?? null).toBeNull();
	});
});

describe('the public visitor and sub-trees (ADR-069)', () => {
	beforeAll(async () => {
		const sub = new SubtreeService(t.db);
		const rootPersonId = `${publicId}:@I1@`;
		await sub.create(
			publicId,
			{ name: 'Open line', slug: 'open-line', rootPersonId, isPublic: true },
			owner.context
		);
		await sub.create(
			publicId,
			{ name: 'Members line', slug: 'members-line', rootPersonId },
			owner.context
		);
	});

	const layout = (segment: string) =>
		modules[LAYOUT]!.load(eventFor(LAYOUT, PUBLIC_VISITOR, paramsFor(LAYOUT, publicId, segment)));

	it('opens a public sub-tree by its tree~slug address and lists it in the switcher', async () => {
		const data = (await layout(`${publicId}~open-line`)) as {
			summary: { subtrees: Array<{ slug: string }>; subtree: { slug: string } | null };
		};
		expect(data.summary.subtree?.slug).toBe('open-line');
		expect(data.summary.subtrees.map((x) => x.slug)).toEqual(['open-line']);
	});

	it('answers a sub-tree that is not public with the 404 of one that does not exist', async () => {
		const refusalOf = (segment: string) =>
			layout(segment).then(
				() => {
					throw new Error(`expected ${segment} to be refused`);
				},
				(e: unknown) => e as { status: number; body: { message: string } }
			);
		const hidden = await refusalOf(`${publicId}~members-line`);
		const unknown = await refusalOf(`${publicId}~no-such-line`);
		expect(hidden.status).toBe(404);
		expect(unknown.status).toBe(404);
		// The message names only the address asked for, so nothing tells the two apart.
		expect(hidden.body.message.replace('members-line', 'x')).toBe(
			unknown.body.message.replace('no-such-line', 'x')
		);
	});
});
