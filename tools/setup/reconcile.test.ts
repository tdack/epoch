import { describe, expect, it } from 'vitest';
import { createCloudflareApi } from './cloudflare.ts';
import { OWNERSHIPS } from './manifest.ts';
import { resourceNames } from './names.ts';
import { RESOURCE_STATES, adoptionsNeeded, reconcile, type Observed } from './reconcile.ts';
import { observe, applyAdoptions } from './steps/reconcile.ts';
import { baseFiles, fakeExec, fixture, memoryFs, testContext, testManifest } from './testing.ts';

const names = resourceNames('epoch');
const OURS = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const HOST = 'epoch.example.com';

const d1 = (marker: string | null, id = 'd1d10000-0000-4000-8000-000000000001') => ({
	id,
	name: names.d1,
	createdAt: '2026-09-01',
	markerInstallId: marker,
	migrationsApplied: 25,
	migrationsExpected: 25,
	trees: 2,
	people: 300,
	users: 3,
	ownerEmails: ['a@example.com'],
	sizeBytes: 245760
});
const r2 = (marker: string | null) => ({
	name: names.r2,
	createdAt: null,
	markerInstallId: marker,
	objectCount: 5,
	sizeBytes: 1000,
	sampleKeys: ['a.jpg']
});
const worker = (
	marker: string | null,
	boundD1Id: string | null = 'd1d10000-0000-4000-8000-000000000001'
) => ({
	name: names.worker,
	lastDeployedAt: '2026-10-01',
	markerInstallId: marker,
	boundD1Id,
	boundR2Name: names.r2,
	boundQueueName: names.queue
});
const queue = (consumerWorker: string | null) => ({
	id: 'queue0000000000000000000000001',
	name: names.queue,
	consumerWorker
});
const app = (domain = `${HOST}/login`, id = 'app00000-0000-4000-8000-000000000002') => ({
	id,
	name: names.accessApp,
	domain,
	aud: 'aud-epoch',
	policyNames: ['Family'],
	deployedAud: 'aud-epoch'
});

const NOTHING: Observed = {
	d1: null,
	r2: null,
	worker: null,
	queue: null,
	accessApp: null,
	accessPolicy: null
};

function manifestWithAll() {
	return testManifest({
		resources: {
			d1: { id: 'd1d10000-0000-4000-8000-000000000001', name: names.d1 },
			r2: { name: names.r2 },
			queue: { id: 'queue0000000000000000000000001', name: names.queue },
			worker: { name: names.worker }
		},
		markersWritten: ['d1', 'r2', 'worker'],
		access: {
			app: { id: 'app00000-0000-4000-8000-000000000002', name: names.accessApp, aud: 'aud-epoch' },
			policies: [],
			idps: []
		}
	});
}

describe('reconcile states', () => {
	it('absent: nothing exists, everything will be created', () => {
		const result = reconcile({ manifest: null, names, hostname: HOST, observed: NOTHING });
		for (const key of ['d1', 'r2', 'queue', 'worker', 'accessApp', 'accessPolicy'] as const) {
			expect(result.reports[key].state).toBe(RESOURCE_STATES.absent);
		}
		expect(result.refusals).toEqual([]);
		expect(adoptionsNeeded(result)).toEqual([]);
	});

	it('ours: every marker matches the manifest', () => {
		const observed: Observed = {
			d1: d1(OURS),
			r2: r2(OURS),
			worker: worker(OURS),
			queue: queue('epoch'),
			accessApp: app(),
			accessPolicy: null
		};
		const result = reconcile({ manifest: manifestWithAll(), names, hostname: HOST, observed });
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.ours);
		expect(result.reports.r2.state).toBe(RESOURCE_STATES.ours);
		expect(result.reports.worker.state).toBe(RESOURCE_STATES.ours);
		expect(result.reports.queue.state).toBe(RESOURCE_STATES.ours);
		expect(result.reports.accessApp.state).toBe(RESOURCE_STATES.ours);
		expect(result.refusals).toEqual([]);
	});

	it('ours: a D1 whose marker is not written yet (the table only exists after migrations)', () => {
		const manifest = { ...manifestWithAll(), markersWritten: ['r2' as const, 'worker' as const] };
		const result = reconcile({
			manifest,
			names,
			hostname: HOST,
			observed: { ...NOTHING, d1: d1(null) }
		});
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.ours);
	});

	it('unmarked: exists with no marker and no manifest, and shows a fingerprint to adopt on', () => {
		const result = reconcile({
			manifest: null,
			names,
			hostname: HOST,
			observed: { ...NOTHING, d1: d1(null), r2: r2(null), worker: worker(null) }
		});
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.unmarked);
		expect(result.reports.d1.fingerprint.join('\n')).toContain('trees: 2, people: 300, users: 3');
		expect(result.reports.d1.fingerprint.join('\n')).toContain('a@example.com');
		expect(adoptionsNeeded(result).map((a) => a.key)).toEqual(['d1', 'r2', 'worker']);
	});

	it('unmarked: in the manifest but the marker has gone', () => {
		const result = reconcile({
			manifest: manifestWithAll(),
			names,
			hostname: HOST,
			observed: { ...NOTHING, d1: d1(null) }
		});
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.unmarked);
	});

	it('orphaned: no manifest, and the markers found all carry one install id', () => {
		const result = reconcile({
			manifest: null,
			names,
			hostname: HOST,
			observed: {
				d1: d1(OTHER),
				r2: r2(OTHER),
				worker: worker(OTHER),
				queue: queue('epoch'),
				accessApp: app(),
				accessPolicy: null
			}
		});
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.orphaned);
		expect(result.reports.queue.state).toBe(RESOURCE_STATES.orphaned);
		expect(result.reports.accessApp.state).toBe(RESOURCE_STATES.orphaned);
		expect(result.installId).toBe(OTHER);
		expect(result.refusals).toEqual([]);
	});

	it('foreign: a manifest exists and the marker carries a different install id', () => {
		const result = reconcile({
			manifest: manifestWithAll(),
			names,
			hostname: HOST,
			observed: { ...NOTHING, d1: d1(OTHER) }
		});
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.foreign);
		expect(result.refusals[0]).toContain(OTHER);
	});

	it('foreign: markers that disagree with each other, even with no manifest', () => {
		const result = reconcile({
			manifest: null,
			names,
			hostname: HOST,
			observed: { ...NOTHING, d1: d1(OURS), r2: r2(OTHER) }
		});
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.foreign);
		expect(result.reports.r2.state).toBe(RESOURCE_STATES.foreign);
		expect(result.refusals.join('\n')).toContain('different install ids');
	});

	it('foreign: a Worker bound to another D1 and carrying no marker is not ours', () => {
		const result = reconcile({
			manifest: null,
			names,
			hostname: HOST,
			observed: {
				...NOTHING,
				d1: d1(null),
				worker: worker(null, 'ffffffff-ffff-4fff-8fff-ffffffffffff')
			}
		});
		expect(result.reports.worker.state).toBe(RESOURCE_STATES.foreign);
		expect(result.reports.worker.reason).toContain('different D1');
	});

	it('foreign: a Worker with the name but no database to compare is bound elsewhere', () => {
		const result = reconcile({
			manifest: null,
			names,
			hostname: HOST,
			observed: { ...NOTHING, worker: worker(null, 'ffffffff-ffff-4fff-8fff-ffffffffffff') }
		});
		expect(result.reports.worker.state).toBe(RESOURCE_STATES.foreign);
	});

	it('warns, rather than refuses, when our own marked Worker has drifted to another D1', () => {
		const result = reconcile({
			manifest: manifestWithAll(),
			names,
			hostname: HOST,
			observed: {
				...NOTHING,
				d1: d1(OURS),
				worker: worker(OURS, 'ffffffff-ffff-4fff-8fff-ffffffffffff')
			}
		});
		expect(result.reports.worker.state).toBe(RESOURCE_STATES.ours);
		expect(result.warnings.join('\n')).toContain('bound to D1 ffffffff');
	});

	it('foreign: a queue consumed by someone else’s Worker', () => {
		const result = reconcile({
			manifest: null,
			names,
			hostname: HOST,
			observed: { ...NOTHING, queue: queue('somebody-elses-worker') }
		});
		expect(result.reports.queue.state).toBe(RESOURCE_STATES.foreign);
	});

	it('unmarked: a queue with no consumer and no manifest id', () => {
		const result = reconcile({
			manifest: null,
			names,
			hostname: HOST,
			observed: { ...NOTHING, queue: queue(null) }
		});
		expect(result.reports.queue.state).toBe(RESOURCE_STATES.unmarked);
	});

	it('foreign: a second application on /login when the manifest records another', () => {
		const result = reconcile({
			manifest: manifestWithAll(),
			names,
			hostname: HOST,
			observed: {
				...NOTHING,
				accessApp: app(`${HOST}/login`, 'app00000-0000-4000-8000-0000000000ff')
			}
		});
		expect(result.reports.accessApp.state).toBe(RESOURCE_STATES.foreign);
	});

	it('absent: an application with our name that serves another path proves nothing', () => {
		const result = reconcile({
			manifest: null,
			names,
			hostname: HOST,
			observed: { ...NOTHING, accessApp: app('elsewhere.example.com/login') }
		});
		expect(result.reports.accessApp.state).toBe(RESOURCE_STATES.absent);
	});

	it('unmarked: an application on /login with nothing to prove it is ours', () => {
		const result = reconcile({
			manifest: null,
			names,
			hostname: HOST,
			observed: { ...NOTHING, accessApp: app() }
		});
		expect(result.reports.accessApp.state).toBe(RESOURCE_STATES.unmarked);
	});
});

describe('shared policies', () => {
	const shared = {
		id: 'pol00000-0000-4000-8000-000000000001',
		name: 'Family',
		appNames: ['Photos', 'Wiki']
	};

	it('a same-named policy that setup did not create is unmarked: referenced, never owned', () => {
		const observed = { ...NOTHING, accessPolicy: { ...shared, name: names.accessPolicy } };
		const result = reconcile({ manifest: null, names, hostname: HOST, observed });
		expect(result.reports.accessPolicy.state).toBe(RESOURCE_STATES.unmarked);
		expect(result.reports.accessPolicy.fingerprint[0]).toContain('Photos, Wiki');
		// Referencing needs no typed name, because setup will not edit it.
		expect(adoptionsNeeded(result)).toEqual([]);
	});

	it('only an id the manifest lists as owned is ours', () => {
		const manifest = testManifest({
			access: {
				app: null,
				idps: [],
				policies: [{ id: shared.id, name: names.accessPolicy, ownership: OWNERSHIPS.owned }]
			}
		});
		const result = reconcile({
			manifest,
			names,
			hostname: HOST,
			observed: { ...NOTHING, accessPolicy: { ...shared, name: names.accessPolicy } }
		});
		expect(result.reports.accessPolicy.state).toBe(RESOURCE_STATES.ours);
	});

	it('warns when the policy the manifest owns has been deleted', () => {
		const manifest = testManifest({
			access: {
				app: null,
				idps: [],
				policies: [{ id: shared.id, name: names.accessPolicy, ownership: OWNERSHIPS.owned }]
			}
		});
		const result = reconcile({ manifest, names, hostname: HOST, observed: NOTHING });
		expect(result.reports.accessPolicy.state).toBe(RESOURCE_STATES.absent);
		expect(result.warnings.join('\n')).toContain('no longer exists');
	});
});

describe('applyAdoptions', () => {
	it('re-attaching an orphaned install keeps its UUID and records what was found', () => {
		const observed: Observed = {
			...NOTHING,
			d1: d1(OTHER),
			r2: r2(OTHER),
			worker: worker(OTHER),
			queue: queue('epoch'),
			accessApp: app()
		};
		const fresh = testManifest({ installId: '99999999-9999-4999-8999-999999999999' });
		const result = reconcile({ manifest: null, names, hostname: HOST, observed });
		const next = applyAdoptions(fresh, result, observed);
		expect(next.installId).toBe(OTHER);
		expect(next.resources.d1?.id).toBe('d1d10000-0000-4000-8000-000000000001');
		expect(next.markersWritten.sort()).toEqual(['d1', 'r2', 'worker']);
		expect(next.isAudSecret).toBe(true);
	});

	it('adopting an unmarked install keeps the new UUID and leaves the markers to be written', () => {
		const observed: Observed = { ...NOTHING, d1: d1(null), worker: worker(null) };
		const fresh = testManifest();
		const next = applyAdoptions(
			fresh,
			reconcile({ manifest: null, names, hostname: HOST, observed }),
			observed
		);
		expect(next.installId).toBe(fresh.installId);
		expect(next.markersWritten).not.toContain('d1');
	});
});

describe('observe, from recorded cf and wrangler output', () => {
	function rules() {
		return [
			{ match: 'cf d1 list', stdout: fixture('d1-list.json') },
			{
				match: 'cf d1 query',
				stdout: [
					{
						results: [
							{ n: 2, install_id: OURS, owner_email: 'a@example.com', email: 'a@example.com' }
						]
					}
				]
			},
			{
				match: 'cf r2 buckets list',
				stdout: { buckets: [{ name: 'epoch-media', creation_date: '2026-09-01' }] }
			},
			{ match: 'cf r2 objects list', stdout: { objects: [{ key: 'a.jpg', size: 10 }] } },
			{ match: 'wrangler r2 object get', stdout: JSON.stringify({ installId: OURS }) },
			{ match: 'cf queues list', stdout: fixture('queues-list.json') },
			{ match: 'cf queues consumers list', stdout: fixture('queue-consumers-ours.json') },
			{ match: 'cf zero-trust access applications list', stdout: fixture('access-apps.json') },
			{ match: 'cf zero-trust access policies list', stdout: fixture('access-policies.json') }
		];
	}

	it('a complete install reads as ours end to end', async () => {
		const exec = fakeExec(rules());
		const { ctx } = testContext({
			exec,
			fs: memoryFs(baseFiles()),
			raw: () => ({
				status: 200,
				body: { success: true, result: fixture('worker-settings-ours.json') }
			})
		});
		ctx.cf.useAccount('acc');
		const manifest = manifestWithAll();
		const observed = await observe(ctx, manifest, HOST);
		const result = reconcile({ manifest, names, hostname: HOST, observed });
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.ours);
		expect(result.reports.worker.state).toBe(RESOURCE_STATES.ours);
		expect(result.reports.accessApp.state).toBe(RESOURCE_STATES.ours);
		expect(observed.d1?.migrationsExpected).toBe(2);
	});

	it('a Worker of that name bound to a different D1 is foreign', async () => {
		const exec = fakeExec(rules());
		const { ctx } = testContext({
			exec,
			raw: () => ({
				status: 200,
				body: { success: true, result: fixture('worker-settings-other-d1.json') }
			})
		});
		ctx.cf.useAccount('acc');
		const observed = await observe(ctx, testManifest(), HOST);
		const result = reconcile({ manifest: null, names, hostname: HOST, observed });
		expect(result.reports.worker.state).toBe(RESOURCE_STATES.foreign);
	});

	it('sets the account in the environment, never on argv', async () => {
		const exec = fakeExec(rules());
		const api = createCloudflareApi(testContext({ exec }).ctx.runner, {});
		api.useAccount('acc0000000000000000000000000001');
		await api.findD1('epoch-db');
		expect(exec.calls[0]?.env?.CLOUDFLARE_ACCOUNT_ID).toBe('acc0000000000000000000000000001');
		expect(exec.calls[0]?.args).not.toContain('acc0000000000000000000000000001');
	});
});
