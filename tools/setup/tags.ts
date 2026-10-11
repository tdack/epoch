import type { CloudflareApi } from './cloudflare.ts';
import type { StepContext } from './context.ts';
import { ERROR_CODES, SetupError, TagConflictError, TagsUnavailableError } from './errors.ts';
import type { Manifest } from './manifest.ts';

/**
 * Resource tags (plan, "Resource tags"): an index and a second witness beside the markers, never
 * proof. Every key is prefixed `epoch.` because keys are account-wide and shared with other apps.
 */
export const TAG_KEYS = {
	instance: 'epoch.instance',
	install: 'epoch.install',
	role: 'epoch.role',
	state: 'epoch.state'
} as const;

export const TAG_STATES = { provisioning: 'provisioning', configured: 'configured' } as const;
export type TagState = (typeof TAG_STATES)[keyof typeof TAG_STATES];

export const TAG_AVAILABILITY = {
	unknown: 'unknown',
	available: 'available',
	unavailable: 'unavailable'
} as const;
export type TagAvailability = (typeof TAG_AVAILABILITY)[keyof typeof TAG_AVAILABILITY];

/** The resources that can carry a tag. The Workflow and reusable Access policies have no taggable type. */
export const TAGGABLE = {
	d1: { role: 'db', type: 'd1_database' },
	r2: { role: 'media', type: 'r2_bucket' },
	queue: { role: 'import-queue', type: 'queue' },
	worker: { role: 'worker', type: 'worker' },
	accessApp: { role: 'access-app', type: 'access_application' }
} as const;
export type TaggableKey = keyof typeof TAGGABLE;
export const TAGGABLE_KEYS = Object.keys(TAGGABLE) as TaggableKey[];

/** One tagged resource, by the canonical id the tags API actually keys on. */
export interface TagTarget {
	key: TaggableKey;
	type: string;
	id: string;
}

export interface TaggedResource {
	type: string;
	id: string;
	name: string;
	tags: Record<string, string>;
	etag: string;
}

export interface TagReading {
	tags: Record<string, string>;
	etag: string;
}

const HEX_32 = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The tags API returns 200 and an empty set for any id, including a Worker's name or a made-up one,
 * and a write to it silently creates a phantom entry. So the id is checked here, before any call.
 */
export function assertCanonicalTagId(type: string, id: string): void {
	const isValid =
		type === 'worker' || type === 'queue'
			? HEX_32.test(id)
			: type === 'd1_database' || type === 'access_application'
				? UUID.test(id)
				: id.length > 0;
	if (!isValid) {
		throw new SetupError(
			ERROR_CODES.command,
			`Refusing to use "${id}" as the id of a ${type} tag: it is not that resource's canonical id`,
			{ hint: 'The tags API accepts any id without complaint, so a wrong one tags nothing.' }
		);
	}
}

const MAX_WRITE_ATTEMPTS = 3;

/**
 * `PUT` replaces every tag on a resource, so each write reads first, merges, and sends the ETag.
 * A 412 means someone else wrote in between: read again and merge again. No write at all when the
 * tags already say what is wanted.
 */
export async function writeTags(
	cf: CloudflareApi,
	target: Pick<TagTarget, 'type' | 'id'>,
	desired: Record<string, string>
): Promise<void> {
	for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
		const current = await cf.getTags(target.type, target.id);
		const merged = { ...current.tags, ...desired };
		if (Object.entries(desired).every(([key, value]) => current.tags[key] === value)) return;
		try {
			await cf.putTags(target.type, target.id, merged, current.etag);
			return;
		} catch (error) {
			if (!(error instanceof TagConflictError) || attempt === MAX_WRITE_ATTEMPTS) throw error;
		}
	}
}

/** What the tags say about one resource. Null fields mean the key is absent. */
export interface TagWitness {
	installId: string | null;
	instance: string | null;
	state: string | null;
}
export type TagWitnesses = Partial<Record<TaggableKey, TagWitness>>;

function witnessOf(resource: TaggedResource): TagWitness {
	return {
		installId: resource.tags[TAG_KEYS.install] ?? null,
		instance: resource.tags[TAG_KEYS.instance] ?? null,
		state: resource.tags[TAG_KEYS.state] ?? null
	};
}

export interface TagIndex {
	resources: TaggedResource[];
}

/**
 * Everything tagged as this install: by name, and by UUID when it is known, to catch a resource
 * whose `epoch.instance` was edited. Null when tags are unavailable, which callers treat as "no
 * tag evidence at all".
 */
export async function readTagIndex(
	cf: CloudflareApi,
	instance: string,
	installId: string | null
): Promise<TagIndex | null> {
	try {
		const byInstance = await cf.listTagged([`${TAG_KEYS.instance}=${instance}`]);
		const byInstall = installId ? await cf.listTagged([`${TAG_KEYS.install}=${installId}`]) : [];
		const seen = new Set<string>();
		const resources = [...byInstance, ...byInstall].filter((r) => {
			const key = `${r.type}:${r.id}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		return { resources };
	} catch (error) {
		if (error instanceof TagsUnavailableError) return null;
		throw error;
	}
}

/** The witness for each observed resource, matched on the canonical id. A resource without tags has none. */
export function witnessesFor(
	index: TagIndex,
	ids: Partial<Record<TaggableKey, string | null>>
): TagWitnesses {
	const witnesses: TagWitnesses = {};
	for (const key of TAGGABLE_KEYS) {
		const id = ids[key];
		if (!id) continue;
		const hit = index.resources.find((r) => r.type === TAGGABLE[key].type && r.id === id);
		if (hit) witnesses[key] = witnessOf(hit);
	}
	return witnesses;
}

/**
 * Tags on something that no longer exists. They are reported, never adopted: R2 tags are keyed by
 * bucket name, so a deleted and re-created bucket would otherwise inherit them.
 */
export function findStale(
	index: TagIndex,
	ids: Partial<Record<TaggableKey, string | null>>
): TaggedResource[] {
	const live = new Set(
		TAGGABLE_KEYS.flatMap((key) => (ids[key] ? [`${TAGGABLE[key].type}:${ids[key]}`] : []))
	);
	return index.resources.filter((r) => !live.has(`${r.type}:${r.id}`));
}

export interface TagInstall {
	instance: string;
	installId: string | null;
	state: string | null;
}

/** Every Epoch install in the account, from one key-only list. A mixed state reads as provisioning. */
export async function listInstalls(cf: CloudflareApi): Promise<TagInstall[] | null> {
	let resources: TaggedResource[];
	try {
		resources = await cf.listTagged([TAG_KEYS.instance]);
	} catch (error) {
		if (error instanceof TagsUnavailableError) return null;
		throw error;
	}
	const byInstance = new Map<string, TagInstall>();
	for (const resource of resources) {
		const witness = witnessOf(resource);
		if (!witness.instance) continue;
		const known = byInstance.get(witness.instance);
		if (!known) {
			byInstance.set(witness.instance, { instance: witness.instance, ...pick(witness) });
		} else if (witness.state !== TAG_STATES.configured) {
			known.state = TAG_STATES.provisioning;
		}
	}
	return [...byInstance.values()];
}

function pick(witness: TagWitness) {
	return { installId: witness.installId, state: witness.state };
}

export const TAG_VERDICTS = {
	/** No tag, or no way to compare: the markers decide, as before tags existed. */
	none: 'none',
	ours: 'ours',
	orphaned: 'orphaned',
	otherInstall: 'other-install',
	disagreesWithMarker: 'disagrees-with-marker'
} as const;
export type TagVerdict = (typeof TAG_VERDICTS)[keyof typeof TAG_VERDICTS];

/**
 * The tag half of the plan's table. `ownId` is the manifest's install UUID, null on a fresh clone,
 * where a tag can only offer to re-attach.
 */
export function classifyTag(
	witness: TagWitness | undefined,
	marker: string | null,
	ownId: string | null
): TagVerdict {
	const tagged = witness?.installId ?? null;
	if (tagged === null) return TAG_VERDICTS.none;
	if (marker !== null && marker !== tagged) return TAG_VERDICTS.disagreesWithMarker;
	if (ownId === null) return TAG_VERDICTS.orphaned;
	return tagged === ownId ? TAG_VERDICTS.ours : TAG_VERDICTS.otherInstall;
}

export function targetsFor(
	manifest: Manifest,
	workerId: string | null
): Partial<Record<TaggableKey, TagTarget>> {
	const targets: Partial<Record<TaggableKey, TagTarget>> = {};
	const add = (key: TaggableKey, id: string | null | undefined) => {
		if (id) targets[key] = { key, type: TAGGABLE[key].type, id };
	};
	add('d1', manifest.resources.d1?.id);
	add('r2', manifest.resources.r2?.name);
	add('queue', manifest.resources.queue?.id);
	add('accessApp', manifest.access.app?.id);
	add('worker', workerId);
	return targets;
}

function desiredTags(
	manifest: Manifest,
	key: TaggableKey,
	state: TagState
): Record<string, string> {
	return {
		[TAG_KEYS.instance]: manifest.workerName,
		[TAG_KEYS.install]: manifest.installId,
		[TAG_KEYS.role]: TAGGABLE[key].role,
		[TAG_KEYS.state]: state
	};
}

/** Remembers a tagged resource so `doctor` and `teardown` know the canonical id without a lookup. */
function withTagged(manifest: Manifest, target: TagTarget): Manifest {
	const rest = manifest.taggedResources.filter((t) => t.key !== target.key);
	return { ...manifest, tags: TAG_AVAILABILITY.available, taggedResources: [...rest, target] };
}

/**
 * Tags the listed resources as this install, with `state`. Tagging never blocks an install: a 403,
 * a missing scope or the beta gate warns once, records `unavailable` and carries on with markers.
 * Anything else throws, so a half-written state is retried by re-running rather than hidden.
 */
export async function tagResources(
	ctx: StepContext,
	manifest: Manifest,
	keys: readonly TaggableKey[],
	state: TagState
): Promise<Manifest> {
	let current = manifest;
	if (current.tags === TAG_AVAILABILITY.unavailable) return current;
	const workerId = keys.includes('worker') ? await resolveWorkerId(ctx, current) : null;
	const targets = targetsFor(current, workerId);
	for (const key of keys) {
		const target = targets[key];
		if (!target) continue;
		try {
			await writeTags(ctx.cf, target, desiredTags(current, key, state));
		} catch (error) {
			if (!(error instanceof TagsUnavailableError)) throw error;
			ctx.report.warn(`resource tags unavailable: ${error.message}; continuing with markers only`);
			return ctx.save({ ...current, tags: TAG_AVAILABILITY.unavailable });
		}
		current = ctx.save(withTagged(current, target));
	}
	return current;
}

/**
 * The Worker's tag key is its script id, not its name. A name is accepted by the API and tags
 * nothing, so when the id cannot be read the Worker is simply left untagged.
 */
async function resolveWorkerId(ctx: StepContext, manifest: Manifest): Promise<string | null> {
	const name = manifest.resources.worker?.name;
	if (!name) return null;
	const known = manifest.taggedResources.find((t) => t.key === 'worker');
	if (known) return known.id;
	const id = await ctx.cf.getWorkerScriptId(name);
	if (id === null)
		ctx.report.warn(`Could not read the script id of Worker ${name}; it stays untagged`);
	return id;
}

/** The step after verify: every resource this run tagged becomes `configured`. */
export function tagConfigured(ctx: StepContext, manifest: Manifest): Promise<Manifest> {
	return tagResources(
		ctx,
		manifest,
		manifest.taggedResources.map((t) => t.key),
		TAG_STATES.configured
	);
}

/**
 * Teardown: removes this install's tags from a resource before it is deleted. A resource whose
 * `epoch.install` is not this install's is left alone, and an unavailable API just skips the step.
 */
export async function untagResource(
	ctx: StepContext,
	manifest: Manifest,
	key: TaggableKey
): Promise<void> {
	const target = manifest.taggedResources.find((t) => t.key === key);
	if (!target) return;
	try {
		const current = await ctx.cf.getTags(target.type, target.id);
		if (current.tags[TAG_KEYS.install] !== manifest.installId) return;
		await ctx.cf.deleteTags(target.type, target.id);
	} catch (error) {
		if (!(error instanceof TagsUnavailableError)) throw error;
		ctx.report.warn(`resource tags unavailable: ${error.message}; its tags were not removed`);
	}
}
