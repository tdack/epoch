/**
 * Importing into an existing tree needs `tree:import` (editor and above), checked against the
 * caller's membership. Driven through the handlers so the test fails if a route stops authorizing.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_DATASET_BYTES, MAX_IMPORT_BYTES } from '../../../lib/server/gedcom/limits';
import type { TreeRole } from '../../../lib/shared/roles';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { POST, PUT } from './+server.js';

const GEDCOM = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 NAME Ada /Lovelace/\n0 TRLR\n';

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['manager', 'editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

function call(handler: typeof POST, actor: TestActor) {
	const body = new FormData();
	body.set('file', new File([GEDCOM], 'tiny.ged'));
	body.set('treeId', treeId);
	body.set('mode', 'merge');
	const event = {
		request: new Request('http://epoch.test/api/import', { method: 'POST', body }),
		locals: { user: actor.context.user, correlationId: actor.context.correlationId },
		platform: { env: { DB: t.d1 } }
	} as unknown as RequestEvent;
	return handler(event);
}

describe.each([
	['import', POST],
	['import preview', PUT]
])('%s into an existing tree', (_name, handler) => {
	it.each(['viewer', 'contributor'] as const)('refuses a %s', async (role) => {
		const response = await call(handler, actors[role]);
		expect(response.status).toBe(403);
		// Today both actions need an editor, so only the named action shows which one was checked.
		expect(((await response.json()) as { error: string }).error).toContain("'tree:import'");
	});

	it('refuses someone who is not a member', async () => {
		const stranger = await createTestUser(t.db, 'stranger');
		const response = await call(handler, stranger);
		expect(response.status).toBe(403);
		expect(((await response.json()) as { error: string }).error).toContain("'tree:import'");
	});

	it.each(['editor', 'manager', 'owner'] as const)('allows an %s', async (role) => {
		const response = await call(handler, actors[role]);
		expect(response.status).toBe(200);
	});
});

describe('import size limits', () => {
	function post(file: File, actor: TestActor) {
		const body = new FormData();
		body.set('file', file);
		body.set('treeId', treeId);
		body.set('mode', 'merge');
		const event = {
			request: new Request('http://epoch.test/api/import', { method: 'POST', body }),
			locals: { user: actor.context.user, correlationId: actor.context.correlationId },
			platform: { env: { DB: t.d1 } }
		} as unknown as RequestEvent;
		return POST(event);
	}

	it('refuses an upload over the cap before reading it', async () => {
		const file = new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], 'huge.ged');
		const response = await post(file, actors.editor);
		expect(response.status).toBe(413);
	}, 60_000);

	it('refuses a small archive that expands past the dataset cap', async () => {
		const bomb = zipSync({ 'gedcom.ged': new Uint8Array(MAX_DATASET_BYTES + 1) });
		const response = await post(new File([bomb], 'bomb.gdz'), actors.editor);
		expect(response.status).toBe(413);
	}, 60_000);

	it('still imports a small GEDZIP', async () => {
		const archive = zipSync({ 'gedcom.ged': new TextEncoder().encode(GEDCOM) });
		const response = await post(new File([archive], 'small.gdz'), actors.editor);
		expect(response.status).toBe(200);
	});
});
