import type { StepContext } from '../context.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { FINGERPRINT_SQL, parseMarkerRows, readMarkerSql } from '../install-meta.ts';
import { AUTH_MODES, OWNERSHIPS, withMarker, withStepDone, type Manifest } from '../manifest.ts';
import { resourceNames } from '../names.ts';
import type { Answers } from '../options.ts';
import {
	RESOURCE_STATES,
	reconcile,
	type Observed,
	type ObservedD1,
	type ObservedR2,
	type ObservedWorker,
	type ReconcileResult
} from '../reconcile.ts';
import { listPoliciesWithApps } from './collect.ts';

/** The R2 marker object, written and read through one key. */
export const R2_MARKER_KEY = '.epoch/install.json';

async function countOf(ctx: StepContext, databaseId: string, sql: string): Promise<number | null> {
	try {
		const rows = (await ctx.cf.queryD1(databaseId, sql)) as { n?: unknown }[];
		return typeof rows[0]?.n === 'number' ? rows[0].n : null;
	} catch {
		return null;
	}
}

/** Counts of the drizzle migrations on disk, with the same naming rule as the app's schema-status. */
function expectedMigrationCount(ctx: StepContext): number {
	return ctx.fs.list(`${ctx.paths.root}/drizzle`).filter((name) => name.endsWith('.sql')).length;
}

async function observeD1(ctx: StepContext, name: string): Promise<ObservedD1 | null> {
	const found = await ctx.cf.findD1(name);
	if (!found) return null;
	// A failed read is "no marker" and "no emails": no table yet means the marker is pending
	// (migration 0025 may not have run), and a fingerprint must never block reconcile.
	const markerInstallId = await ctx.cf
		.queryD1(found.id, readMarkerSql())
		.then((rows) => parseMarkerRows(rows)?.installId ?? null)
		.catch(() => null);
	const ownerEmails = await ctx.cf
		.queryD1(found.id, FINGERPRINT_SQL.ownerEmails)
		.then((rows) =>
			(rows as { email?: string }[])
				.map((row) => row.email)
				.filter((email): email is string => typeof email === 'string')
		)
		.catch((): string[] => []);
	return {
		id: found.id,
		name: found.name,
		createdAt: found.createdAt,
		markerInstallId,
		migrationsApplied: await countOf(ctx, found.id, FINGERPRINT_SQL.migrations),
		migrationsExpected: expectedMigrationCount(ctx),
		trees: await countOf(ctx, found.id, FINGERPRINT_SQL.trees),
		people: await countOf(ctx, found.id, FINGERPRINT_SQL.people),
		users: await countOf(ctx, found.id, FINGERPRINT_SQL.users),
		ownerEmails,
		sizeBytes: found.sizeBytes
	};
}

async function observeR2(
	ctx: StepContext,
	manifest: Manifest,
	name: string
): Promise<ObservedR2 | null> {
	const found = await ctx.cf.findR2Bucket(name);
	if (!found) return null;
	let objects = { keys: [] as string[], sizeBytes: 0, isTruncated: false };
	try {
		objects = await ctx.cf.listR2Objects(name, 20);
	} catch {
		ctx.report.warn(`Could not list objects in ${name}; the fingerprint will be incomplete`);
	}
	let markerInstallId: string | null = null;
	// An ephemeral token exists only for the deploy, so before that there is no wrangler login to read with.
	if (manifest.authMode !== AUTH_MODES.ephemeral) {
		try {
			const text = await ctx
				.makeWrangler({ kind: 'profile', accountId: manifest.account?.id ?? '' })
				.getObject(name, R2_MARKER_KEY);
			const parsed = text ? (JSON.parse(text) as { installId?: unknown }) : null;
			markerInstallId = typeof parsed?.installId === 'string' ? parsed.installId : null;
		} catch {
			markerInstallId = null;
		}
	} else if (objects.keys.includes(R2_MARKER_KEY)) {
		ctx.report.warn(
			'The bucket has an install marker, but it cannot be read before the deploy token exists; it is treated as unmarked'
		);
	}
	return {
		name,
		createdAt: found.createdAt,
		markerInstallId,
		objectCount: objects.isTruncated ? null : objects.keys.length,
		sizeBytes: objects.sizeBytes,
		sampleKeys: objects.keys.slice(0, 3)
	};
}

/** Read-only. Everything the table in plan step 4 needs, gathered in one place. */
export async function observe(
	ctx: StepContext,
	manifest: Manifest,
	hostname: string
): Promise<Observed> {
	const names = resourceNames(manifest.workerName);
	const [d1, r2, worker, queue, apps, policies] = await Promise.all([
		observeD1(ctx, names.d1),
		observeR2(ctx, manifest, names.r2),
		ctx.cf.getWorker(names.worker),
		ctx.cf.findQueue(names.queue),
		ctx.cf.listAccessApps(),
		listPoliciesWithApps(ctx)
	]);
	const domain = `${hostname}/login`;
	const app =
		apps.find((a) => a.id === manifest.access.app?.id) ??
		apps.find((a) => a.domain === domain) ??
		null;
	const ownedId = manifest.access.policies.find((p) => p.ownership === OWNERSHIPS.owned)?.id;
	const policy =
		policies.find((p) => p.id === ownedId) ??
		policies.find((p) => p.name === names.accessPolicy) ??
		null;
	let deployedAud: string | null = null;
	if (app && worker) {
		try {
			deployedAud = await ctx.cf.readWorkerVar(names.worker, 'CF_ACCESS_AUD');
		} catch {
			deployedAud = null;
		}
	}
	return {
		d1,
		r2,
		worker,
		queue,
		accessApp: app
			? {
					id: app.id,
					name: app.name,
					domain: app.domain,
					aud: app.aud,
					deployedAud,
					policyNames: policies.filter((p) => app.policyIds.includes(p.id)).map((p) => p.name)
				}
			: null,
		accessPolicy: policy ? { id: policy.id, name: policy.name, appNames: policy.appNames } : null
	};
}

export async function reconcileStep(
	ctx: StepContext,
	manifest: Manifest,
	answers: Answers,
	hasManifest: boolean
): Promise<{
	manifest: Manifest;
	result: ReconcileResult;
	observed: Observed;
	/** A Worker of this name that is not ours; the flow asks what to do with it (rename, adopt, replace). */
	existingWorker: ObservedWorker | null;
}> {
	const observed = await observe(ctx, manifest, answers.hostname);
	// A manifest created in this very run has no history, so a resource of that name is not "ours"
	// just because the file exists; only a manifest read from disk counts as evidence.
	const result = reconcile({
		manifest: hasManifest ? manifest : null,
		names: resourceNames(manifest.workerName),
		hostname: answers.hostname,
		observed
	});
	const workerState = result.reports.worker.state;
	const existingWorker =
		observed.worker &&
		(workerState === RESOURCE_STATES.unmarked || workerState === RESOURCE_STATES.foreign)
			? observed.worker
			: null;
	// The Worker's own refusal is the existing-Worker prompt's to handle; anything else still stops here.
	const refusals = existingWorker
		? result.refusals.filter((line) => !line.startsWith(`${result.reports.worker.name}: `))
		: result.refusals;
	if (refusals.length > 0) {
		throw new SetupError(
			ERROR_CODES.foreign,
			`Setup will not use resources that belong to something else:\n  ${refusals.join('\n  ')}`,
			{
				hint: 'Choose another install with --name, or release them from the checkout that owns them. There is no override.'
			}
		);
	}
	for (const warning of result.warnings) ctx.report.warn(warning);
	return {
		manifest: ctx.save(withStepDone(manifest, 'reconcile')),
		result,
		observed,
		existingWorker
	};
}

/**
 * Records the adopted resources in the manifest once their names have been typed. Re-attaching an
 * orphaned install keeps its UUID, so the markers already in Cloudflare stay valid.
 */
export function applyAdoptions(
	manifest: Manifest,
	result: ReconcileResult,
	observed: Observed,
	/** The existing Worker is being replaced, not adopted: it is not recorded as ours and its AUD secret is not inherited. */
	isWorkerReplaced = false
): Manifest {
	let next: Manifest = structuredClone(manifest);
	const isOrphaned = Object.values(result.reports).some(
		(r) => r.state === RESOURCE_STATES.orphaned
	);
	if (isOrphaned && result.installId) next.installId = result.installId;
	const usable = (key: keyof ReconcileResult['reports']) =>
		result.reports[key].state !== RESOURCE_STATES.absent;
	if (observed.d1 && usable('d1')) {
		next.resources.d1 = { id: observed.d1.id, name: observed.d1.name };
		next = withMarker(next, 'd1', observed.d1.markerInstallId === next.installId);
	}
	if (observed.r2 && usable('r2')) {
		next.resources.r2 = { name: observed.r2.name };
		next = withMarker(next, 'r2', observed.r2.markerInstallId === next.installId);
	}
	if (observed.worker && usable('worker') && !isWorkerReplaced) {
		next.resources.worker = { name: observed.worker.name };
		next = withMarker(next, 'worker', observed.worker.markerInstallId === next.installId);
	}
	if (observed.queue && usable('queue'))
		next.resources.queue = { id: observed.queue.id, name: observed.queue.name };
	if (observed.accessApp && usable('accessApp')) {
		next.access.app = {
			id: observed.accessApp.id,
			name: observed.accessApp.name,
			aud: observed.accessApp.aud
		};
	}
	// An adopted install's CF_ACCESS_AUD is already a secret; a var of the same name may be refused (SPIKE).
	if (isOrphaned || (result.reports.worker.state === RESOURCE_STATES.unmarked && !isWorkerReplaced))
		next.isAudSecret = true;
	return next;
}
