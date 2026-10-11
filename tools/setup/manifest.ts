import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ERROR_CODES, SetupError } from './errors.ts';
import type { TagAvailability, TagTarget } from './tags.ts';

/** In flow order. `collect` and `plan` hold answers, not resources, but are recorded so a resume skips them. */
export const STEP_NAMES = [
	'preflight',
	'sign-in',
	'collect',
	'reconcile',
	'plan',
	'provision',
	'access',
	'write-config',
	'migrate-mark-deploy',
	'verify',
	'mark-configured',
	'hand-off'
] as const;
export type StepName = (typeof STEP_NAMES)[number];

export const AUTH_MODES = {
	profile: 'profile',
	ephemeral: 'ephemeral',
	envToken: 'env-token'
} as const;
export type AuthMode = (typeof AUTH_MODES)[keyof typeof AUTH_MODES];

export const OWNERSHIPS = { owned: 'owned', referenced: 'referenced' } as const;
type Ownership = (typeof OWNERSHIPS)[keyof typeof OWNERSHIPS];

export type MarkerKey = 'd1' | 'r2' | 'worker';

export function hasMarker(manifest: Manifest, key: MarkerKey): boolean {
	return manifest.markersWritten.includes(key);
}

/** Records whether a marker is in place, as seen by the last check or write. */
export function withMarker(manifest: Manifest, key: MarkerKey, isWritten: boolean): Manifest {
	const rest = manifest.markersWritten.filter((k) => k !== key);
	return { ...manifest, markersWritten: isWritten ? [...rest, key] : rest };
}

export interface PolicyRef {
	id: string;
	name: string;
	/** Only a policy this tool created is `owned`; `allow` and `disallow` refuse the rest. */
	ownership: Ownership;
}

export interface Manifest {
	version: 1;
	/** Written into D1, R2 and the Worker as proof that a resource belongs to this install. */
	installId: string;
	workerName: string;
	createdAt: string;
	updatedAt: string;
	completedSteps: StepName[];
	authMode: AuthMode;
	account: { id: string; name: string } | null;
	ownerEmail: string | null;
	zone: { id: string; name: string } | null;
	hosting: 'workers-dev' | 'custom' | null;
	isWorkersDevKept: boolean;
	hostname: string | null;
	teamDomain: string | null;
	locations: { d1Hint: string | null; r2Hint: string | null; r2Jurisdiction: string | null };
	/** The verified Email Sending sender, or null when the generated config omits `send_email`. */
	emailSender: string | null;
	resources: {
		d1: { id: string; name: string } | null;
		r2: { name: string } | null;
		queue: { id: string; name: string } | null;
		worker: { name: string } | null;
	};
	/** Markers that have been written. The D1 one cannot exist before migrations have run. */
	markersWritten: MarkerKey[];
	access: {
		app: { id: string; name: string; aud: string } | null;
		policies: PolicyRef[];
		idps: string[];
	};
	/** Whether the last run could use resource tags; `unavailable` means markers alone. */
	tags: TagAvailability;
	/** Resources this install has tagged, by the canonical id the tags API keys on. */
	taggedResources: TagTarget[];
	/** An adopted install keeps `CF_ACCESS_AUD` as a secret; a new one carries it as a var. */
	isAudSecret: boolean;
}

export function newManifest(workerName: string, now: Date = new Date()): Manifest {
	const stamp = now.toISOString();
	return {
		version: 1,
		installId: randomUUID(),
		workerName,
		createdAt: stamp,
		updatedAt: stamp,
		completedSteps: [],
		authMode: AUTH_MODES.profile,
		account: null,
		ownerEmail: null,
		zone: null,
		hosting: null,
		isWorkersDevKept: false,
		hostname: null,
		teamDomain: null,
		locations: { d1Hint: null, r2Hint: null, r2Jurisdiction: null },
		emailSender: null,
		resources: { d1: null, r2: null, queue: null, worker: null },
		markersWritten: [],
		access: { app: null, policies: [], idps: [] },
		tags: 'unknown',
		taggedResources: [],
		isAudSecret: false
	};
}

function hasCompleted(manifest: Manifest, step: StepName): boolean {
	return manifest.completedSteps.includes(step);
}

export function withStepDone(manifest: Manifest, step: StepName): Manifest {
	if (hasCompleted(manifest, step)) return manifest;
	return { ...manifest, completedSteps: [...manifest.completedSteps, step] };
}

/** The first step in flow order that has not completed, or null when the install is finished. */
export function nextStep(manifest: Manifest): StepName | null {
	return STEP_NAMES.find((step) => !hasCompleted(manifest, step)) ?? null;
}

export function lastCompletedStep(manifest: Manifest): StepName | null {
	return [...STEP_NAMES].reverse().find((step) => hasCompleted(manifest, step)) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseManifest(text: string): Manifest {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (cause) {
		throw new SetupError(ERROR_CODES.manifest, 'The install manifest is not valid JSON', { cause });
	}
	// Only the fields every step relies on are checked; the rest are written by this tool.
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		typeof value.installId !== 'string' ||
		typeof value.workerName !== 'string' ||
		!Array.isArray(value.completedSteps) ||
		!isRecord(value.resources) ||
		!isRecord(value.access)
	) {
		throw new SetupError(ERROR_CODES.manifest, 'The install manifest has an unknown shape', {
			hint: 'It was probably written by a newer version of this tool. Keep a copy, then remove .epoch/install.json to re-attach from what exists in Cloudflare.'
		});
	}
	// A manifest from before resource tags has neither field.
	return { tags: 'unknown', taggedResources: [], ...value } as unknown as Manifest;
}

/** Same as `readManifest`, through the context's file system so tests and the real run share one path. */
export function loadManifest(
	fs: { exists(path: string): boolean; read(path: string): string },
	file: string
): Manifest | null {
	return fs.exists(file) ? parseManifest(fs.read(file)) : null;
}

export function readManifest(file: string): Manifest | null {
	let text: string;
	try {
		text = readFileSync(file, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
	return parseManifest(text);
}

/**
 * Written to a temp file and renamed so a crash or Ctrl-C mid-write cannot leave half a file:
 * the manifest is the only record of which resources this install created.
 */
export function writeManifest(file: string, manifest: Manifest, now: Date = new Date()): Manifest {
	const stamped = { ...manifest, updatedAt: now.toISOString() };
	mkdirSync(dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(stamped, null, '\t')}\n`);
	renameSync(temp, file);
	return stamped;
}
