import { hasMarker, type Manifest } from './manifest.ts';
import type { ResourceNames } from './names.ts';
import { TAG_VERDICTS, classifyTag, type TagWitnesses } from './tags.ts';

export const RESOURCE_STATES = {
	absent: 'absent',
	ours: 'ours',
	unmarked: 'unmarked',
	orphaned: 'orphaned',
	foreign: 'foreign'
} as const;
type ResourceState = (typeof RESOURCE_STATES)[keyof typeof RESOURCE_STATES];

export const RESOURCE_KEYS = ['d1', 'r2', 'queue', 'worker', 'accessApp', 'accessPolicy'] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

/** What read-only checks found. Everything is optional-by-null: a failed fingerprint must not block reconcile. */
export interface ObservedD1 {
	id: string;
	name: string;
	createdAt: string | null;
	/** `install_meta.install_id`, or null when the table or row is absent. */
	markerInstallId: string | null;
	migrationsApplied: number | null;
	migrationsExpected: number;
	trees: number | null;
	people: number | null;
	users: number | null;
	ownerEmails: string[];
	sizeBytes: number | null;
}

export interface ObservedR2 {
	name: string;
	createdAt: string | null;
	/** `.epoch/install.json` → `installId`. */
	markerInstallId: string | null;
	objectCount: number | null;
	sizeBytes: number | null;
	sampleKeys: string[];
}

export interface ObservedWorker {
	name: string;
	lastDeployedAt: string | null;
	/** The `EPOCH_INSTALL_ID` var. */
	markerInstallId: string | null;
	boundD1Id: string | null;
	boundR2Name: string | null;
	boundQueueName: string | null;
}

export interface ObservedQueue {
	id: string;
	name: string;
	/** Script name of the consumer, or null when none. */
	consumerWorker: string | null;
}

interface ObservedAccessApp {
	id: string;
	name: string;
	/** Hostname plus path as Access stores it, e.g. `epoch.example.com/login`. */
	domain: string;
	aud: string;
	policyNames: string[];
	/** The deployed Worker's `CF_ACCESS_AUD`, when it could be read. */
	deployedAud: string | null;
}

interface ObservedPolicy {
	id: string;
	name: string;
	appNames: string[];
}

export interface Observed {
	d1: ObservedD1 | null;
	r2: ObservedR2 | null;
	worker: ObservedWorker | null;
	queue: ObservedQueue | null;
	accessApp: ObservedAccessApp | null;
	accessPolicy: ObservedPolicy | null;
}

interface ResourceReport {
	key: ResourceKey;
	name: string;
	state: ResourceState;
	reason: string;
	/** What the user sees before typing a name to adopt. */
	fingerprint: string[];
	markerInstallId: string | null;
}

export interface ReconcileResult {
	reports: Record<ResourceKey, ResourceReport>;
	/** The UUID this run keeps: the manifest's, or the one every marker agrees on. */
	installId: string | null;
	/** One line per `foreign` resource or disagreement. Non-empty means setup must stop. */
	refusals: string[];
	/** Drift that does not block setup. */
	warnings: string[];
}

interface ReconcileInput {
	manifest: Manifest | null;
	names: ResourceNames;
	hostname: string | null;
	observed: Observed;
	/**
	 * What resource tags say, by resource. Undefined when tags are unavailable or were not read: the
	 * markers then decide alone, exactly as before tags existed.
	 */
	tags?: TagWitnesses;
}

function sizeText(bytes: number | null): string {
	if (bytes === null) return 'size unknown';
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function count(label: string, value: number | null): string {
	return `${label}: ${value ?? 'unknown'}`;
}

function fingerprintLines(key: ResourceKey, observed: Observed): string[] {
	switch (key) {
		case 'd1': {
			const d1 = observed.d1;
			if (!d1) return [];
			return [
				`migrations applied: ${d1.migrationsApplied ?? 'unknown'} of ${d1.migrationsExpected} in drizzle/`,
				[count('trees', d1.trees), count('people', d1.people), count('users', d1.users)].join(', '),
				`owner emails: ${d1.ownerEmails.length > 0 ? d1.ownerEmails.join(', ') : 'none found'}`,
				`${sizeText(d1.sizeBytes)}, created ${d1.createdAt ?? 'unknown'}`
			];
		}
		case 'r2': {
			const r2 = observed.r2;
			if (!r2) return [];
			return [
				`${r2.objectCount ?? 'unknown'} objects, ${sizeText(r2.sizeBytes)}`,
				`sample keys: ${r2.sampleKeys.length > 0 ? r2.sampleKeys.join(', ') : 'none'}`
			];
		}
		case 'worker': {
			const worker = observed.worker;
			if (!worker) return [];
			return [
				`last deployed ${worker.lastDeployedAt ?? 'never'}`,
				`bound D1 ${worker.boundD1Id ?? 'none'}, R2 ${worker.boundR2Name ?? 'none'}, queue ${worker.boundQueueName ?? 'none'}`
			];
		}
		case 'queue': {
			const queue = observed.queue;
			if (!queue) return [];
			return [`consumer: ${queue.consumerWorker ?? 'none'}`];
		}
		case 'accessApp': {
			const app = observed.accessApp;
			if (!app) return [];
			return [
				`domain ${app.domain}, AUD ${app.aud}`,
				`policies: ${app.policyNames.length > 0 ? app.policyNames.join(', ') : 'none'}`,
				app.deployedAud === null
					? 'deployed CF_ACCESS_AUD: not readable'
					: `deployed CF_ACCESS_AUD ${app.deployedAud === app.aud ? 'matches' : 'DIFFERS'}`
			];
		}
		case 'accessPolicy': {
			const policy = observed.accessPolicy;
			if (!policy) return [];
			return [`used by: ${policy.appNames.length > 0 ? policy.appNames.join(', ') : 'no apps'}`];
		}
	}
}

/**
 * Decides, for each resource, whether it is ours. Names are not proof: a state needs a marker
 * (or, where none is possible, the manifest's id). Pure, so every state is tested from fixtures.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
	const { manifest, names, hostname, observed, tags } = input;
	const refusals: string[] = [];
	const warnings: string[] = [];
	const ownId = manifest?.installId ?? null;

	const markersFound = [
		observed.d1?.markerInstallId,
		observed.r2?.markerInstallId,
		observed.worker?.markerInstallId,
		tags?.d1?.installId,
		tags?.r2?.installId,
		tags?.worker?.installId
	].filter((marker): marker is string => typeof marker === 'string');
	const distinct = new Set(markersFound);
	const isDisagreeing = distinct.size > 1;
	const groupId = distinct.size === 1 ? [...distinct][0]! : null;
	if (isDisagreeing) {
		refusals.push(
			'The D1, R2 and Worker markers and tags carry different install ids; they are not one install'
		);
	}

	const reports = {} as Record<ResourceKey, ResourceReport>;
	function report(
		key: ResourceKey,
		name: string,
		state: ResourceState,
		reason: string,
		marker: string | null = null
	) {
		reports[key] = {
			key,
			name,
			state,
			reason,
			fingerprint: state === RESOURCE_STATES.absent ? [] : fingerprintLines(key, observed),
			markerInstallId: marker
		};
		if (state === RESOURCE_STATES.foreign) refusals.push(`${name}: ${reason}`);
	}

	/** Shared rule for the three resources that can carry a marker. */
	function markedState(
		key: 'd1' | 'r2' | 'worker',
		name: string,
		marker: string | null,
		isInManifest: boolean
	): [ResourceState, string] {
		const witness = tags?.[key];
		switch (classifyTag(witness, marker, ownId)) {
			case TAG_VERDICTS.disagreesWithMarker:
				return [
					RESOURCE_STATES.foreign,
					`its tag says install ${witness?.installId} but its marker says ${marker}: the two witnesses disagree`
				];
			case TAG_VERDICTS.otherInstall:
				return [
					RESOURCE_STATES.foreign,
					`it is tagged for install ${witness?.installId} (${witness?.instance ?? 'unnamed'}), not ${ownId}`
				];
			case TAG_VERDICTS.ours:
				return [RESOURCE_STATES.ours, 'carries this install’s tag'];
			case TAG_VERDICTS.orphaned:
				return [
					RESOURCE_STATES.orphaned,
					`is tagged for install ${witness?.installId} and there is no manifest here`
				];
		}
		if (isDisagreeing && marker !== null) {
			return [RESOURCE_STATES.foreign, 'its marker disagrees with the other resources'];
		}
		if (marker !== null) {
			if (ownId !== null) {
				return marker === ownId
					? [RESOURCE_STATES.ours, 'carries this install’s marker']
					: [RESOURCE_STATES.foreign, `its marker belongs to install ${marker}, not ${ownId}`];
			}
			return [RESOURCE_STATES.orphaned, `carries install ${marker} and there is no manifest here`];
		}
		if (isInManifest && manifest && !hasMarker(manifest, key)) {
			return [RESOURCE_STATES.ours, 'in the manifest; its marker is not written yet'];
		}
		if (isInManifest) {
			return [RESOURCE_STATES.unmarked, 'in the manifest, but its marker has gone'];
		}
		return [RESOURCE_STATES.unmarked, 'exists with no marker and is not in the manifest'];
	}

	// D1
	if (!observed.d1) {
		report('d1', names.d1, RESOURCE_STATES.absent, 'nothing by that name');
	} else {
		const isIn = manifest?.resources.d1?.id === observed.d1.id;
		const [state, reason] = markedState('d1', names.d1, observed.d1.markerInstallId, isIn);
		report('d1', names.d1, state, reason, observed.d1.markerInstallId);
	}

	// R2
	if (!observed.r2) {
		report('r2', names.r2, RESOURCE_STATES.absent, 'nothing by that name');
	} else {
		const isIn = manifest?.resources.r2?.name === observed.r2.name;
		const [state, reason] = markedState('r2', names.r2, observed.r2.markerInstallId, isIn);
		report('r2', names.r2, state, reason, observed.r2.markerInstallId);
	}

	// Worker: bindings are the second line of evidence, because a name can be reused for anything.
	if (!observed.worker) {
		report('worker', names.worker, RESOURCE_STATES.absent, 'nothing by that name');
	} else {
		const worker = observed.worker;
		const isIn = manifest?.resources.worker?.name === worker.name;
		let [state, reason] = markedState('worker', names.worker, worker.markerInstallId, isIn);
		const expectedD1 = manifest?.resources.d1?.id ?? observed.d1?.id ?? null;
		const isBoundElsewhere = worker.boundD1Id !== null && worker.boundD1Id !== expectedD1;
		if (isBoundElsewhere) {
			if (state === RESOURCE_STATES.ours) {
				warnings.push(
					`${names.worker} is bound to D1 ${worker.boundD1Id}, not ${expectedD1 ?? 'a new database'}`
				);
			} else if (state !== RESOURCE_STATES.foreign) {
				state = RESOURCE_STATES.foreign;
				reason = `it is bound to a different D1 (${worker.boundD1Id}) than ${expectedD1 ?? 'the one setup would create'}`;
			}
		}
		report('worker', names.worker, state, reason, worker.markerInstallId);
	}

	// Queue: no marker is possible, so its consumer and the manifest are the evidence.
	if (!observed.queue) {
		report('queue', names.queue, RESOURCE_STATES.absent, 'nothing by that name');
	} else {
		const queue = observed.queue;
		const queueTag = classifyTag(tags?.queue, null, ownId);
		if (queue.consumerWorker !== null && queue.consumerWorker !== names.worker) {
			report(
				'queue',
				names.queue,
				RESOURCE_STATES.foreign,
				`its consumer is the Worker "${queue.consumerWorker}"`
			);
		} else if (queueTag === TAG_VERDICTS.otherInstall) {
			report(
				'queue',
				names.queue,
				RESOURCE_STATES.foreign,
				`it is tagged for install ${tags?.queue?.installId} (${tags?.queue?.instance ?? 'unnamed'}), not ${ownId}`
			);
		} else if (queueTag === TAG_VERDICTS.ours) {
			report('queue', names.queue, RESOURCE_STATES.ours, 'carries this install’s tag');
		} else if (manifest?.resources.queue?.id === queue.id) {
			report('queue', names.queue, RESOURCE_STATES.ours, 'its id is in the manifest');
		} else if (queueTag === TAG_VERDICTS.orphaned) {
			report(
				'queue',
				names.queue,
				RESOURCE_STATES.orphaned,
				`is tagged for install ${tags?.queue?.installId} and there is no manifest here`
			);
		} else if (
			ownId === null &&
			queue.consumerWorker === names.worker &&
			reports.worker.state === RESOURCE_STATES.orphaned
		) {
			report(
				'queue',
				names.queue,
				RESOURCE_STATES.orphaned,
				`consumed by the orphaned Worker of install ${groupId}`
			);
		} else {
			report(
				'queue',
				names.queue,
				RESOURCE_STATES.unmarked,
				'exists, and its id is not in the manifest'
			);
		}
	}

	// Access application: found by id, or by serving exactly `<host>/login`. A name alone proves nothing.
	const app = observed.accessApp;
	const expectedDomain = hostname ? `${hostname}/login` : null;
	if (!app) {
		if (manifest?.access.app) {
			warnings.push(
				`The Access application ${manifest.access.app.id} in the manifest no longer exists`
			);
		}
		report('accessApp', names.accessApp, RESOURCE_STATES.absent, 'no application serves that path');
	} else if (manifest?.access.app?.id === app.id) {
		report('accessApp', app.name, RESOURCE_STATES.ours, 'its id is in the manifest');
	} else if (
		expectedDomain !== null &&
		app.domain === expectedDomain &&
		classifyTag(tags?.accessApp, null, ownId) === TAG_VERDICTS.otherInstall
	) {
		report(
			'accessApp',
			app.name,
			RESOURCE_STATES.foreign,
			`it is tagged for install ${tags?.accessApp?.installId} (${tags?.accessApp?.instance ?? 'unnamed'}), not ${ownId}`
		);
	} else if (expectedDomain !== null && app.domain === expectedDomain) {
		const appTag = classifyTag(tags?.accessApp, null, ownId);
		if (appTag === TAG_VERDICTS.ours) {
			report('accessApp', app.name, RESOURCE_STATES.ours, 'carries this install’s tag');
		} else if (appTag === TAG_VERDICTS.orphaned) {
			report(
				'accessApp',
				app.name,
				RESOURCE_STATES.orphaned,
				`is tagged for install ${tags?.accessApp?.installId} and there is no manifest here`
			);
		} else if (manifest?.access.app) {
			report(
				'accessApp',
				app.name,
				RESOURCE_STATES.foreign,
				`the manifest records ${manifest.access.app.id}, but ${app.id} also serves ${app.domain}`
			);
		} else if (ownId !== null && groupId === ownId) {
			report(
				'accessApp',
				app.name,
				RESOURCE_STATES.ours,
				'serves this install’s host and the markers on it match'
			);
		} else if (ownId === null && groupId !== null) {
			report(
				'accessApp',
				app.name,
				RESOURCE_STATES.orphaned,
				`serves the host of install ${groupId}`
			);
		} else {
			report(
				'accessApp',
				app.name,
				RESOURCE_STATES.unmarked,
				'serves this path; nothing proves it is ours'
			);
		}
	} else {
		report('accessApp', names.accessApp, RESOURCE_STATES.absent, 'no application serves that path');
	}

	// Policy: only ever "ours" when this tool created it. A same-named policy is referenced, never owned.
	const policy = observed.accessPolicy;
	const ownedPolicy = manifest?.access.policies.find((ref) => ref.ownership === 'owned') ?? null;
	if (!policy) {
		if (ownedPolicy)
			warnings.push(`The Access policy ${ownedPolicy.id} in the manifest no longer exists`);
		report('accessPolicy', names.accessPolicy, RESOURCE_STATES.absent, 'nothing by that name');
	} else if (ownedPolicy?.id === policy.id) {
		report('accessPolicy', names.accessPolicy, RESOURCE_STATES.ours, 'its id is in the manifest');
	} else {
		report(
			'accessPolicy',
			names.accessPolicy,
			RESOURCE_STATES.unmarked,
			'a policy with that name exists that setup did not create; it can be referenced, not edited'
		);
	}

	return { reports, installId: ownId ?? groupId, refusals, warnings };
}

export interface Adoption {
	key: ResourceKey;
	/** The exact text the user must type. */
	name: string;
	state: typeof RESOURCE_STATES.unmarked | typeof RESOURCE_STATES.orphaned;
}

/**
 * Resources that need a typed name before setup may use them. Policies are left out: setup never
 * edits one it did not create, so referencing it needs no typed confirmation.
 */
export function adoptionsNeeded(result: ReconcileResult): Adoption[] {
	const adoptions: Adoption[] = [];
	for (const key of RESOURCE_KEYS) {
		if (key === 'accessPolicy') continue;
		const entry = result.reports[key];
		if (entry.state === RESOURCE_STATES.unmarked || entry.state === RESOURCE_STATES.orphaned) {
			adoptions.push({ key, name: entry.name, state: entry.state });
		}
	}
	return adoptions;
}
