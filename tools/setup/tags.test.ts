import { describe, expect, it } from 'vitest';
import { createCloudflareApi, type CloudflareApi } from './cloudflare.ts';
import { TagConflictError, TagsUnavailableError } from './errors.ts';
import { resourceNames } from './names.ts';
import { RESOURCE_STATES, reconcile, type Observed } from './reconcile.ts';
import { createRunner } from './run.ts';
import {
	TAG_AVAILABILITY,
	TAG_KEYS,
	TAG_STATES,
	findStale,
	listInstalls,
	tagConfigured,
	tagResources,
	untagResource,
	witnessesFor,
	writeTags,
	type TaggedResource
} from './tags.ts';
import { reconcileStep } from './steps/reconcile.ts';
import type { Answers } from './options.ts';
import { fakeExec, fixture, stubApi, testContext, testManifest } from './testing.ts';

const OURS = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const D1_ID = 'd1d10000-0000-4000-8000-000000000001';
const WORKER_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const QUEUE_ID = 'queue0000000000000000000000001'.replace(/[^0-9a-f]/g, '0').padEnd(32, '0');
const names = resourceNames('epoch');

function api(rules: Parameters<typeof fakeExec>[0]) {
	const exec = fakeExec(rules);
	const cf = createCloudflareApi(createRunner(exec), {});
	cf.useAccount('acc0000000000000000000000000001');
	return { cf, exec };
}

/** An in-memory tags API with real compare-and-swap, so retry and merge are tested, not mocked. */
function memoryTags(initial: Record<string, string> = {}) {
	let tags = { ...initial };
	let version = 1;
	const log: string[] = [];
	let beforeNextPut: (() => void) | null = null;
	const cf = stubApi({
		getTags: async () => ({ tags: { ...tags }, etag: `v${version}` }),
		putTags: async (_type, _id, next, etag) => {
			beforeNextPut?.();
			beforeNextPut = null;
			if (etag !== `v${version}`) throw new TagConflictError('cf account-tags update');
			tags = { ...next };
			version += 1;
			log.push(JSON.stringify(next));
		}
	});
	return {
		cf,
		log,
		current: () => tags,
		/** Someone else writes between our read and our write. */
		raceOnce(change: Record<string, string>) {
			beforeNextPut = () => {
				tags = { ...tags, ...change };
				version += 1;
			};
		}
	};
}

describe('writing tags', () => {
	it('keeps every tag the tool did not set', async () => {
		const store = memoryTags({ configured: 'yes', 'biblioteca.instance': 'x' });
		await writeTags(
			store.cf,
			{ type: 'd1_database', id: D1_ID },
			{ [TAG_KEYS.instance]: 'epoch', [TAG_KEYS.state]: TAG_STATES.provisioning }
		);
		expect(store.current()).toEqual({
			configured: 'yes',
			'biblioteca.instance': 'x',
			[TAG_KEYS.instance]: 'epoch',
			[TAG_KEYS.state]: 'provisioning'
		});
	});

	it('retries a 412 from a fresh read, so the other writer’s tag survives', async () => {
		const store = memoryTags();
		store.raceOnce({ 'someone.else': 'wrote this' });
		await writeTags(store.cf, { type: 'queue', id: QUEUE_ID }, { [TAG_KEYS.instance]: 'epoch' });
		expect(store.current()).toEqual({ 'someone.else': 'wrote this', [TAG_KEYS.instance]: 'epoch' });
		expect(store.log).toHaveLength(1);
	});

	it('gives up after three conflicts and says so', async () => {
		let puts = 0;
		const cf = stubApi({
			putTags: async () => {
				puts += 1;
				throw new TagConflictError('cf account-tags update');
			}
		});
		await expect(writeTags(cf, { type: 'queue', id: QUEUE_ID }, { a: 'b' })).rejects.toThrow(
			TagConflictError
		);
		expect(puts).toBe(3);
	});

	it('does not write when the tags already say it', async () => {
		const store = memoryTags({ [TAG_KEYS.state]: 'configured' });
		await writeTags(store.cf, { type: 'queue', id: QUEUE_ID }, { [TAG_KEYS.state]: 'configured' });
		expect(store.log).toEqual([]);
	});
});

describe('the cf wrappers', () => {
	it('lists from the recorded shape and passes each filter as --tag', async () => {
		const { cf, exec } = api([
			{ match: 'cf tags resources list', stdout: fixture('tags-resources-list.json') }
		]);
		const found = await cf.listTagged(['biblioteca.instance=biblioteca-cc', 'x']);
		expect(found).toHaveLength(11);
		expect(found[0]).toMatchObject({
			type: 'access_application',
			etag: 'v1:rDSaxsUFk6fehxuyMVUImg',
			tags: { 'biblioteca.instance': 'biblioteca-cc' }
		});
		expect(exec.calls[0]!.args).toEqual([
			'tags',
			'resources',
			'list',
			'--tag',
			'biblioteca.instance=biblioteca-cc',
			'--tag',
			'x'
		]);
	});

	it('reads the ETag of an untagged resource from get', async () => {
		const { cf } = api([
			{ match: 'cf account-tags get', stdout: fixture('tags-get-untagged.json') }
		]);
		expect(await cf.getTags('worker', WORKER_ID)).toEqual({
			tags: {},
			etag: 'v1:RBNvo1WzZ4oRRq0W9-hkng'
		});
	});

	it('writes with --body carrying all three fields, and --if-match', async () => {
		const { cf, exec } = api([{ match: 'cf account-tags update', stdout: {} }]);
		await cf.putTags('worker', WORKER_ID, { a: 'b' }, 'v1:abc');
		const args = exec.calls[0]!.args;
		expect(JSON.parse(args[args.indexOf('--body') + 1]!)).toEqual({
			resource_type: 'worker',
			resource_id: WORKER_ID,
			tags: { a: 'b' }
		});
		expect(args.slice(args.indexOf('--if-match'))).toEqual(['--if-match', 'v1:abc']);
		expect(args).not.toContain('--tags');
	});

	it('deletes with a body of type and id, and --force so cf never prompts', async () => {
		const { cf, exec } = api([{ match: 'cf account-tags delete', stdout: {} }]);
		await cf.deleteTags('d1_database', D1_ID);
		const args = exec.calls[0]!.args;
		expect(JSON.parse(args[args.indexOf('--body') + 1]!)).toEqual({
			resource_type: 'd1_database',
			resource_id: D1_ID
		});
		expect(args).toContain('--force');
	});

	it('maps a 412 to a conflict and a 403 to unavailable; anything else is a plain failure', async () => {
		const update = (stderr: string) =>
			api([{ match: 'cf account-tags update', exitCode: 1, stderr }]).cf.putTags(
				'worker',
				WORKER_ID,
				{},
				'v1:a'
			);
		await expect(update('HTTP 412 Precondition Failed')).rejects.toThrow(TagConflictError);
		await expect(update('HTTP 403 Forbidden (9109)')).rejects.toThrow(TagsUnavailableError);
		await expect(update('boom: socket closed')).rejects.not.toThrow(TagsUnavailableError);
		await expect(update('boom: socket closed')).rejects.not.toThrow(TagConflictError);
	});

	it('never tags a Worker by name, an empty id, or a made-up D1 id', async () => {
		const { cf, exec } = api([]);
		await expect(cf.getTags('worker', 'epoch')).rejects.toThrow('canonical id');
		await expect(cf.putTags('worker', 'epoch-genealogy', {}, 'v1:a')).rejects.toThrow(
			'canonical id'
		);
		await expect(cf.putTags('queue', '', {}, 'v1:a')).rejects.toThrow('canonical id');
		await expect(cf.deleteTags('d1_database', 'not-a-uuid')).rejects.toThrow('canonical id');
		expect(exec.calls).toEqual([]);
	});

	it('reads the Worker script id from `tag` in the scripts list, never from the name', async () => {
		const exec = fakeExec([]);
		const cf = createCloudflareApi(createRunner(exec), {
			rawGet: async () => ({
				status: 200,
				body: {
					result: [
						{ id: 'epoch', tag: WORKER_ID },
						{ id: 'other', tag: 'f'.repeat(32) }
					]
				}
			})
		});
		cf.useAccount('acc0000000000000000000000000001');
		expect(await cf.getWorkerScriptId('epoch')).toBe(WORKER_ID);
		expect(await cf.getWorkerScriptId('missing')).toBeNull();
	});
});

function resource(type: string, id: string, tags: Record<string, string>): TaggedResource {
	return { type, id, name: '', tags, etag: 'v1:x' };
}
const ownTags = (install = OURS, extra: Record<string, string> = {}) => ({
	[TAG_KEYS.instance]: 'epoch',
	[TAG_KEYS.install]: install,
	...extra
});

const observedBase: Observed = {
	d1: {
		id: D1_ID,
		name: names.d1,
		createdAt: null,
		markerInstallId: null,
		migrationsApplied: 1,
		migrationsExpected: 1,
		trees: 0,
		people: 0,
		users: 0,
		ownerEmails: [],
		sizeBytes: null
	},
	r2: null,
	worker: null,
	queue: null,
	accessApp: null,
	accessPolicy: null
};

describe('tags as a second witness in reconcile', () => {
	const witnessD1 = (install: string, instance = 'epoch') =>
		witnessesFor(
			{
				resources: [
					resource('d1_database', D1_ID, { ...ownTags(install), [TAG_KEYS.instance]: instance })
				]
			},
			{ d1: D1_ID }
		);
	const run = (manifestId: string | null, observed: Observed, tags = witnessD1(OURS)) =>
		reconcile({
			manifest: manifestId ? testManifest({ installId: manifestId }) : null,
			names,
			hostname: 'epoch.example.com',
			observed,
			tags
		});

	it('a tag for another install is foreign and names that install', () => {
		const result = run(OURS, observedBase, witnessD1(OTHER, 'epoch-test'));
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.foreign);
		expect(result.reports.d1.reason).toContain(OTHER);
		expect(result.reports.d1.reason).toContain('epoch-test');
		expect(result.refusals).toHaveLength(1);
	});

	it('a tag that disagrees with the D1 marker is foreign', () => {
		const observed = { ...observedBase, d1: { ...observedBase.d1!, markerInstallId: OTHER } };
		const result = run(OURS, observed);
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.foreign);
		expect(result.reports.d1.reason).toContain('disagree');
	});

	it('this install’s tag with no marker yet is ours', () => {
		expect(run(OURS, observedBase).reports.d1.state).toBe(RESOURCE_STATES.ours);
	});

	it('this install’s tag on a fresh clone is orphaned, and the install id is carried over', () => {
		const result = run(null, observedBase);
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.orphaned);
		expect(result.installId).toBe(OURS);
	});

	it('a marker with no tag is ours as before, and no marker and no tag is unmarked', () => {
		const marked = { ...observedBase, d1: { ...observedBase.d1!, markerInstallId: OURS } };
		expect(run(OURS, marked, {}).reports.d1.state).toBe(RESOURCE_STATES.ours);
		expect(run(OURS, observedBase, {}).reports.d1.state).toBe(RESOURCE_STATES.unmarked);
	});

	it('the queue and the Access app take the tag as their only witness', () => {
		const queueId = QUEUE_ID;
		const observed: Observed = {
			...observedBase,
			d1: null,
			queue: { id: queueId, name: names.queue, consumerWorker: names.worker },
			accessApp: {
				id: 'a9a9a9a9-0000-4000-8000-000000000001',
				name: names.accessApp,
				domain: 'epoch.example.com/login',
				aud: 'aud',
				policyNames: [],
				deployedAud: null
			}
		};
		const tagFor = (install: string) =>
			witnessesFor(
				{
					resources: [
						resource('queue', queueId, ownTags(install)),
						resource('access_application', 'a9a9a9a9-0000-4000-8000-000000000001', ownTags(install))
					]
				},
				{ queue: queueId, accessApp: 'a9a9a9a9-0000-4000-8000-000000000001' }
			);
		const ours = run(OURS, observed, tagFor(OURS));
		expect(ours.reports.queue.state).toBe(RESOURCE_STATES.ours);
		expect(ours.reports.accessApp.state).toBe(RESOURCE_STATES.ours);
		const theirs = run(OURS, observed, tagFor(OTHER));
		expect(theirs.reports.queue.state).toBe(RESOURCE_STATES.foreign);
		expect(theirs.reports.accessApp.state).toBe(RESOURCE_STATES.foreign);
	});

	it('with no tag evidence at all it behaves exactly as before tags existed', () => {
		const withTags = run(OURS, observedBase, {});
		const without = reconcile({
			manifest: testManifest({ installId: OURS }),
			names,
			hostname: 'epoch.example.com',
			observed: observedBase
		});
		expect(withTags).toEqual(without);
	});
});

describe('stale tags', () => {
	it('a tag on a resource that no longer exists is stale and never becomes a witness', () => {
		const index = { resources: [resource('d1_database', D1_ID, ownTags())] };
		expect(findStale(index, { d1: null })).toHaveLength(1);
		expect(witnessesFor(index, { d1: null })).toEqual({});
		expect(findStale(index, { d1: D1_ID })).toEqual([]);
	});

	it('an R2 tag follows the bucket name, so a re-created bucket is seen as tagged only if listed', () => {
		const index = { resources: [resource('r2_bucket', names.r2, ownTags())] };
		expect(witnessesFor(index, { r2: names.r2 }).r2?.installId).toBe(OURS);
	});
});

describe('tagging a manifest’s resources', () => {
	const full = () =>
		testManifest({
			installId: OURS,
			resources: {
				d1: { id: D1_ID, name: names.d1 },
				r2: { name: names.r2 },
				queue: { id: QUEUE_ID, name: names.queue },
				worker: { name: names.worker }
			},
			access: {
				app: { id: 'a9a9a9a9-0000-4000-8000-000000000001', name: 'a', aud: 'x' },
				policies: [],
				idps: []
			}
		});

	it('tags each resource by its canonical id and records what it tagged', async () => {
		const puts: { type: string; id: string; tags: Record<string, string> }[] = [];
		const { ctx } = testContext({
			cf: stubApi({
				getWorkerScriptId: async () => WORKER_ID,
				putTags: async (type, id, tags) => {
					puts.push({ type, id, tags });
				}
			})
		});
		const next = await tagResources(
			ctx,
			full(),
			['d1', 'r2', 'queue', 'accessApp', 'worker'],
			TAG_STATES.provisioning
		);
		expect(puts.map((p) => [p.type, p.id])).toEqual([
			['d1_database', D1_ID],
			['r2_bucket', names.r2],
			['queue', QUEUE_ID],
			['access_application', 'a9a9a9a9-0000-4000-8000-000000000001'],
			['worker', WORKER_ID]
		]);
		expect(puts[4]!.tags).toEqual({
			[TAG_KEYS.instance]: 'epoch',
			[TAG_KEYS.install]: OURS,
			[TAG_KEYS.role]: 'worker',
			[TAG_KEYS.state]: 'provisioning'
		});
		expect(next.taggedResources).toHaveLength(5);
		expect(next.tags).toBe(TAG_AVAILABILITY.available);
	});

	it('leaves the Worker untagged, with a warning, when its script id cannot be read', async () => {
		let puts = 0;
		const { ctx, report } = testContext({
			cf: stubApi({
				getWorkerScriptId: async () => null,
				putTags: async () => {
					puts += 1;
				}
			})
		});
		const next = await tagResources(ctx, full(), ['worker'], TAG_STATES.provisioning);
		expect(puts).toBe(0);
		expect(next.taggedResources).toEqual([]);
		expect(report.warnings.join()).toContain('script id');
	});

	it('a 403 degrades to markers only: one warning, no throw, and no further tag calls', async () => {
		let gets = 0;
		const { ctx, report } = testContext({
			cf: stubApi({
				getTags: async () => {
					gets += 1;
					throw new TagsUnavailableError(
						'This login lacks the permission for `cf account-tags get`'
					);
				}
			})
		});
		const next = await tagResources(ctx, full(), ['d1', 'r2', 'queue'], TAG_STATES.provisioning);
		expect(next.tags).toBe(TAG_AVAILABILITY.unavailable);
		expect(report.warnings).toHaveLength(1);
		expect(report.warnings[0]).toContain('resource tags unavailable');
		expect(gets).toBe(1);
		const again = await tagResources(ctx, next, ['d1'], TAG_STATES.configured);
		expect(gets).toBe(1);
		expect(again).toBe(next);
	});

	it('any other failure throws rather than being hidden', async () => {
		const { ctx } = testContext({
			cf: stubApi({
				getTags: async () => {
					throw new Error('socket closed');
				}
			})
		});
		await expect(tagResources(ctx, full(), ['d1'], TAG_STATES.provisioning)).rejects.toThrow(
			'socket closed'
		);
	});

	it('marking configured flips every resource it tagged', async () => {
		const states: string[] = [];
		const { ctx } = testContext({
			cf: stubApi({
				putTags: async (_t, _i, tags) => {
					states.push(tags[TAG_KEYS.state]!);
				}
			})
		});
		const tagged = await tagResources(ctx, full(), ['d1', 'r2'], TAG_STATES.provisioning);
		states.length = 0;
		await tagConfigured(ctx, tagged);
		expect(states).toEqual(['configured', 'configured']);
	});

	it('teardown deletes tags only when the install tag matches the manifest', async () => {
		const deleted: string[] = [];
		const { ctx } = testContext({
			cf: stubApi({
				getTags: async (_t, id) => ({
					tags: { [TAG_KEYS.install]: id === D1_ID ? OURS : OTHER },
					etag: 'v1:a'
				}),
				deleteTags: async (_t, id) => {
					deleted.push(id);
				}
			})
		});
		const manifest = {
			...full(),
			taggedResources: [
				{ key: 'd1' as const, type: 'd1_database', id: D1_ID },
				{ key: 'queue' as const, type: 'queue', id: QUEUE_ID }
			]
		};
		await untagResource(ctx, manifest, 'd1');
		await untagResource(ctx, manifest, 'queue');
		expect(deleted).toEqual([D1_ID]);
	});
});

describe('other installs', () => {
	it('groups the key-only list by instance and reads a mixed install as provisioning', async () => {
		const cf: CloudflareApi = stubApi({
			listTagged: async () => [
				resource('d1_database', D1_ID, ownTags(OURS, { [TAG_KEYS.state]: 'configured' })),
				resource('queue', QUEUE_ID, ownTags(OURS, { [TAG_KEYS.state]: 'provisioning' })),
				resource('d1_database', 'f'.repeat(36), {
					[TAG_KEYS.instance]: 'epoch-test',
					[TAG_KEYS.install]: OTHER,
					[TAG_KEYS.state]: 'configured'
				})
			]
		});
		expect(await listInstalls(cf)).toEqual([
			{ instance: 'epoch', installId: OURS, state: 'provisioning' },
			{ instance: 'epoch-test', installId: OTHER, state: 'configured' }
		]);
	});

	it('reads as unavailable (null) when tags cannot be listed', async () => {
		const cf = stubApi({
			listTagged: async () => {
				throw new TagsUnavailableError('scope');
			}
		});
		expect(await listInstalls(cf)).toBeNull();
	});
});

describe('the reconcile step’s name check', () => {
	const answers = { hostname: 'epoch.example.com', typedAdoptions: {} } as Answers;
	const empty = {
		findD1: async () => null,
		findR2Bucket: async () => null,
		getWorker: async () => null,
		findQueue: async () => null,
		listAccessApps: async () => [],
		listPolicies: async () => []
	};
	const installs = [
		resource('d1_database', D1_ID, ownTags(OTHER, { [TAG_KEYS.state]: 'configured' })),
		resource('d1_database', 'f'.repeat(36), {
			[TAG_KEYS.instance]: 'epoch-test',
			[TAG_KEYS.install]: 'c'.repeat(8) + '-cccc-4ccc-8ccc-' + 'c'.repeat(12),
			[TAG_KEYS.state]: 'configured'
		})
	];

	it('refuses a name another install already uses, before looking anything else up', async () => {
		const { ctx } = testContext({
			cf: stubApi({
				...empty,
				listTagged: async () => installs,
				findD1: () => Promise.reject(new Error('looked up'))
			})
		});
		await expect(
			reconcileStep(ctx, testManifest({ installId: OURS }), answers, true)
		).rejects.toThrow(`already used by install ${OTHER}`);
	});

	it('leaves a fresh clone to reconcile, lists the other installs, and records availability', async () => {
		const { ctx, report } = testContext({
			cf: stubApi({ ...empty, listTagged: async () => installs })
		});
		const out = await reconcileStep(ctx, testManifest({ installId: OURS }), answers, false);
		expect(report.infos.join('\n')).toContain('epoch-test: configured');
		expect(out.manifest.tags).toBe(TAG_AVAILABILITY.available);
	});

	it('degrades to markers only when tags are unavailable', async () => {
		const { ctx, report } = testContext({
			cf: stubApi({
				...empty,
				listTagged: async () => {
					throw new TagsUnavailableError('scope');
				}
			})
		});
		const out = await reconcileStep(ctx, testManifest({ installId: OURS }), answers, true);
		expect(out.manifest.tags).toBe(TAG_AVAILABILITY.unavailable);
		expect(report.warnings.join()).toContain('resource tags unavailable');
	});
});
