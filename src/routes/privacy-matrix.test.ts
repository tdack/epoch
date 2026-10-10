/**
 * Every endpoint and page load, and the test that proves a private person cannot be reached
 * through it (ADR-015). The routes are found on disk, so a new one with no entry here fails this
 * test: the matrix cannot silently fall behind the transports.
 */

import { describe, expect, it } from 'vitest';

type Kind =
	/** Paged in SQL with the visibility predicate beside `tree_id`. */
	| 'paged-sql'
	/** Built from loaded rows with private people masked or omitted. */
	| 'masked-rows'
	/** A write or its preview: planned over visible rows, refused if the real ops touch a private person. */
	| 'guarded-write'
	/** Needs a role that sees everyone, or checks the tree and record before serving. */
	| 'role-gated'
	/** The caller's own data, filtered to people they may see. */
	| 'own-data'
	/** Carries no record of a tree at all. */
	| 'no-record-data'
	/** A page load: it only calls the endpoints above. */
	| 'via-api';

interface Entry {
	kind: Kind;
	/** The test file that proves it, relative to `src/lib/server`. */
	covers: string;
}

const READS = 'services/privacy-reads.test.ts';
const RECORDS = 'services/privacy-records.test.ts';
const WRITES = 'services/privacy-writes.test.ts';
const ACCESS = 'services/privacy-access.test.ts';
const MEMBERS = 'services/member-service.test.ts';
const EVIDENCE = 'services/privacy-evidence.test.ts';
const NOTES = 'services/privacy-notes.test.ts';
const TASKS = 'services/privacy-tasks.test.ts';

const API = './api';
const ENTRIES: Record<string, Entry> = {
	[`${API}/export/+server.ts`]: { kind: 'role-gated', covers: ACCESS },
	[`${API}/export/status/[instanceId]/+server.ts`]: { kind: 'role-gated', covers: ACCESS },
	[`${API}/export/download/[instanceId]/+server.ts`]: { kind: 'role-gated', covers: ACCESS },
	[`${API}/import/+server.ts`]: { kind: 'role-gated', covers: 'auth/authorization.test.ts' },
	[`${API}/media/[...key]/+server.ts`]: { kind: 'role-gated', covers: ACCESS },
	[`${API}/media/upload/+server.ts`]: { kind: 'role-gated', covers: ACCESS },
	[`${API}/trees/+server.ts`]: { kind: 'no-record-data', covers: ACCESS },
	[`${API}/trees/[id]/+server.ts`]: { kind: 'role-gated', covers: ACCESS },
	[`${API}/trees/[id]/charts/descendants/+server.ts`]: {
		kind: 'masked-rows',
		covers: 'services/chart-service.test.ts'
	},
	[`${API}/trees/[id]/charts/pedigree/+server.ts`]: {
		kind: 'masked-rows',
		covers: 'services/chart-service.test.ts'
	},
	[`${API}/trees/[id]/citations/+server.ts`]: { kind: 'guarded-write', covers: EVIDENCE },
	[`${API}/trees/[id]/citations/[citationId]/+server.ts`]: {
		kind: 'guarded-write',
		covers: EVIDENCE
	},
	[`${API}/trees/[id]/citations/reorder/+server.ts`]: { kind: 'guarded-write', covers: EVIDENCE },
	[`${API}/trees/[id]/facts/[factId]/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	[`${API}/trees/[id]/facts/impact/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	[`${API}/trees/[id]/graph/+server.ts`]: { kind: 'masked-rows', covers: RECORDS },
	[`${API}/trees/[id]/impact/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	[`${API}/trees/[id]/invitations/+server.ts`]: { kind: 'role-gated', covers: MEMBERS },
	[`${API}/trees/[id]/invitations/[invitationId]/+server.ts`]: {
		kind: 'role-gated',
		covers: MEMBERS
	},
	[`${API}/trees/[id]/members/+server.ts`]: { kind: 'role-gated', covers: MEMBERS },
	[`${API}/trees/[id]/members/[userId]/+server.ts`]: { kind: 'role-gated', covers: MEMBERS },
	[`${API}/trees/[id]/lists/individuals/+server.ts`]: { kind: 'paged-sql', covers: READS },
	[`${API}/trees/[id]/lists/repositories/+server.ts`]: { kind: 'paged-sql', covers: EVIDENCE },
	[`${API}/trees/[id]/lists/sources/+server.ts`]: { kind: 'paged-sql', covers: EVIDENCE },
	[`${API}/trees/[id]/lists/surnames/+server.ts`]: { kind: 'paged-sql', covers: READS },
	[`${API}/trees/[id]/lists/unions/+server.ts`]: { kind: 'paged-sql', covers: READS },
	[`${API}/trees/[id]/default-view/+server.ts`]: {
		kind: 'role-gated',
		covers: 'services/tree-view-mode.test.ts'
	},
	[`${API}/trees/[id]/view-mode/+server.ts`]: {
		kind: 'no-record-data',
		covers: 'services/tree-view-mode.test.ts'
	},
	[`${API}/trees/[id]/marks/+server.ts`]: { kind: 'own-data', covers: READS },
	[`${API}/trees/[id]/marks/favorites/[personId]/+server.ts`]: { kind: 'own-data', covers: READS },
	[`${API}/trees/[id]/marks/recents/+server.ts`]: { kind: 'own-data', covers: READS },
	[`${API}/trees/[id]/lists/notes/+server.ts`]: { kind: 'paged-sql', covers: NOTES },
	[`${API}/trees/[id]/names/[nameId]/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	[`${API}/trees/[id]/names/impact/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	[`${API}/trees/[id]/quality/+server.ts`]: {
		kind: 'masked-rows',
		covers: 'services/quality-service.test.ts'
	},
	[`${API}/trees/[id]/places/+server.ts`]: {
		kind: 'paged-sql',
		covers: 'services/place-service.test.ts'
	},
	[`${API}/trees/[id]/places/[placeId]/+server.ts`]: {
		kind: 'guarded-write',
		covers: 'services/place-service.test.ts'
	},
	[`${API}/trees/[id]/places/[placeId]/impact/+server.ts`]: {
		kind: 'guarded-write',
		covers: 'services/place-service.test.ts'
	},
	// Sweeps every date, private people's included, so it is a manager's alone.
	[`${API}/trees/[id]/dates/standardise/+server.ts`]: {
		kind: 'role-gated',
		covers: 'services/date-service.test.ts'
	},
	[`${API}/trees/[id]/people-search/+server.ts`]: { kind: 'paged-sql', covers: READS },
	[`${API}/trees/[id]/note-links/+server.ts`]: { kind: 'guarded-write', covers: NOTES },
	[`${API}/trees/[id]/note-links/[linkId]/+server.ts`]: { kind: 'guarded-write', covers: NOTES },
	[`${API}/trees/[id]/note-links/[linkId]/share/+server.ts`]: {
		kind: 'guarded-write',
		covers: NOTES
	},
	[`${API}/trees/[id]/note-links/reorder/+server.ts`]: { kind: 'guarded-write', covers: NOTES },
	// The GET is a masked read (a shared note is listed and served only for a viewer who sees a record
	// that uses it, or who made it); the PUT and DELETE are the more dangerous half, so the entry names
	// the write kind.
	[`${API}/trees/[id]/notes/+server.ts`]: { kind: 'guarded-write', covers: NOTES },
	[`${API}/trees/[id]/notes/[noteId]/+server.ts`]: { kind: 'guarded-write', covers: NOTES },
	[`${API}/trees/[id]/notes/[noteId]/merge/+server.ts`]: { kind: 'guarded-write', covers: NOTES },
	[`${API}/trees/[id]/notes/impact/+server.ts`]: { kind: 'guarded-write', covers: NOTES },
	[`${API}/trees/[id]/people/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	// The GET is a masked read (proved by RECORDS); the PUT and DELETE are writes, which is the more
	// dangerous half, so the entry names the write proof.
	[`${API}/trees/[id]/people/[personId]/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	[`${API}/trees/[id]/people/[personId]/merge/+server.ts`]: {
		kind: 'guarded-write',
		covers: 'services/person-merge-service.test.ts'
	},
	[`${API}/trees/[id]/people/[personId]/merge/impact/+server.ts`]: {
		kind: 'guarded-write',
		covers: 'services/person-merge-service.test.ts'
	},
	[`${API}/trees/[id]/people/[personId]/facts/+server.ts`]: {
		kind: 'guarded-write',
		covers: WRITES
	},
	[`${API}/trees/[id]/people/[personId]/facts/reorder/+server.ts`]: {
		kind: 'guarded-write',
		covers: WRITES
	},
	[`${API}/trees/[id]/people/[personId]/names/+server.ts`]: {
		kind: 'guarded-write',
		covers: WRITES
	},
	[`${API}/trees/[id]/people/[personId]/names/preferred/+server.ts`]: {
		kind: 'guarded-write',
		covers: WRITES
	},
	[`${API}/trees/[id]/people/[personId]/names/reorder/+server.ts`]: {
		kind: 'guarded-write',
		covers: WRITES
	},
	[`${API}/trees/[id]/people/[personId]/privacy/+server.ts`]: {
		kind: 'guarded-write',
		covers: 'services/privacy-service.test.ts'
	},
	[`${API}/trees/[id]/privacy/+server.ts`]: {
		kind: 'role-gated',
		covers: 'services/privacy-service.test.ts'
	},
	[`${API}/trees/[id]/relationships/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	[`${API}/trees/[id]/relationships/plan/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	[`${API}/trees/[id]/relationships/remove/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	[`${API}/trees/[id]/relationship/+server.ts`]: {
		kind: 'masked-rows',
		covers: 'services/kinship-service.test.ts'
	},
	[`${API}/trees/[id]/repositories/+server.ts`]: { kind: 'guarded-write', covers: EVIDENCE },
	[`${API}/trees/[id]/repositories/[repositoryId]/+server.ts`]: {
		kind: 'guarded-write',
		covers: EVIDENCE
	},
	[`${API}/trees/[id]/search/+server.ts`]: { kind: 'paged-sql', covers: READS },
	[`${API}/trees/[id]/source-links/[linkId]/+server.ts`]: {
		kind: 'guarded-write',
		covers: EVIDENCE
	},
	[`${API}/trees/[id]/sources/+server.ts`]: { kind: 'guarded-write', covers: EVIDENCE },
	// The GET is a masked read (a source is listed and served only for a viewer who sees something it
	// supports); the PUT and DELETE are the more dangerous half, so the entry names the write kind.
	[`${API}/trees/[id]/sources/[sourceId]/+server.ts`]: { kind: 'guarded-write', covers: EVIDENCE },
	[`${API}/trees/[id]/sources/[sourceId]/merge/+server.ts`]: {
		kind: 'guarded-write',
		covers: EVIDENCE
	},
	[`${API}/trees/[id]/sources/[sourceId]/repositories/+server.ts`]: {
		kind: 'guarded-write',
		covers: EVIDENCE
	},
	[`${API}/trees/[id]/sources/impact/+server.ts`]: { kind: 'guarded-write', covers: EVIDENCE },
	[`${API}/trees/[id]/summary/+server.ts`]: { kind: 'masked-rows', covers: RECORDS },
	// The GET lists tasks in SQL with the visibility predicate beside `tree_id`; the POST, PUT and
	// DELETE are the more dangerous half, so the entries name the write kind.
	[`${API}/trees/[id]/tasks/+server.ts`]: { kind: 'guarded-write', covers: TASKS },
	[`${API}/trees/[id]/tasks/[taskId]/+server.ts`]: { kind: 'guarded-write', covers: TASKS },
	[`${API}/trees/[id]/tasks/impact/+server.ts`]: { kind: 'guarded-write', covers: TASKS },
	[`${API}/trees/[id]/undo/+server.ts`]: { kind: 'guarded-write', covers: WRITES },
	[`${API}/trees/[id]/unions/[unionId]/+server.ts`]: { kind: 'masked-rows', covers: RECORDS },
	[`${API}/trees/[id]/unions/merge/+server.ts`]: { kind: 'guarded-write', covers: WRITES }
};

/** Page and layout loads fetch the endpoints above and hold no data of their own. */
const LOADS = [
	'./+page.ts',
	'./trees/[id]/+layout.ts',
	'./trees/[id]/+page.ts',
	'./trees/[id]/members/+page.ts',
	'./trees/[id]/people/+page.ts',
	'./trees/[id]/notes/+page.ts',
	'./trees/[id]/notes/[noteId]/+page.ts',
	'./trees/[id]/place/+page.ts',
	'./trees/[id]/places/+page.ts',
	'./trees/[id]/people/[personId]/+page.ts',
	'./trees/[id]/people/[personId]/descendants/+page.ts',
	'./trees/[id]/people/[personId]/fan/+page.ts',
	'./trees/[id]/people/[personId]/hourglass/+page.ts',
	'./trees/[id]/people/[personId]/pedigree/+page.ts',
	'./trees/[id]/privacy/+page.ts',
	'./trees/[id]/quality/+page.ts',
	'./trees/[id]/relationship/+page.ts',
	'./trees/[id]/search/+page.ts',
	'./trees/[id]/sources/+page.ts',
	'./trees/[id]/sources/[sourceId]/+page.ts',
	'./trees/[id]/surnames/+page.ts',
	'./trees/[id]/tasks/+page.ts',
	'./trees/[id]/unions/+page.ts',
	'./trees/[id]/unions/[unionId]/+page.ts'
];

const endpoints = Object.keys(import.meta.glob('./**/+server.ts')).sort();
const loads = Object.keys(
	import.meta.glob([
		'./**/+page.ts',
		'./**/+layout.ts',
		'./**/+page.server.ts',
		'./**/+layout.server.ts'
	])
).sort();
/** Loads that read no tree at all, so there is no person in them to hide. */
const NO_RECORD_LOADS = ['./login/+page.server.ts', './welcome/+page.server.ts'];

const proofs = new Set(
	Object.keys(import.meta.glob('../lib/server/**/*.test.ts')).map((k) =>
		k.replace('../lib/server/', '')
	)
);

describe('the privacy matrix covers every transport', () => {
	it('has an entry for every endpoint, and none for an endpoint that is gone', () => {
		expect(Object.keys(ENTRIES).sort()).toEqual(endpoints);
	});

	it('names a test file that exists for every endpoint', () => {
		for (const [route, entry] of Object.entries(ENTRIES)) {
			expect(proofs.has(entry.covers), `${route} cites ${entry.covers}`).toBe(true);
		}
	});

	it('has an entry for every page and layout load, and none that fetch nothing it lists', () => {
		expect(loads).toEqual([...LOADS, ...NO_RECORD_LOADS].sort());
	});
});
