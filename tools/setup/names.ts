import { ERROR_CODES, SetupError } from './errors.ts';

/** 63 is the limit for a bucket or queue name, and the longest suffix added to the Worker name is `-export-workflow`. */
const MAX_WORKER_NAME_LENGTH = 63 - '-export-workflow'.length;
const WORKER_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function assertValidWorkerName(workerName: string): void {
	if (workerName.length > MAX_WORKER_NAME_LENGTH || !WORKER_NAME_PATTERN.test(workerName)) {
		throw new SetupError(ERROR_CODES.usage, `"${workerName}" cannot be an install workerName`, {
			hint: `Use up to ${MAX_WORKER_NAME_LENGTH} lowercase letters, digits and hyphens, not starting or ending with a hyphen.`,
			flag: '--name'
		});
	}
}

/**
 * Every account-level name derives from the workerName, so two checkouts with different slugs cannot
 * collide. Workflow names are per account too, which is why the workflow is derived as well.
 * With the workerName `epoch-genealogy` these equal the names in the tracked wrangler.jsonc, which is
 * how the repository's own install is adopted without renaming anything.
 */
export function resourceNames(workerName: string) {
	return {
		worker: workerName,
		d1: `${workerName}-db`,
		r2: `${workerName}-media`,
		queue: `${workerName}-import-queue`,
		workflow: `${workerName}-export-workflow`,
		placeMatchWorkflow: `${workerName}-match-workflow`,
		accessApp: `Epoch (${workerName})`,
		accessPolicy: `Epoch ${workerName} sign-in`,
		profile: `epoch-${workerName}`,
		/** Prefix of the short-lived deploy tokens, so a sweep can find leftovers. */
		ephemeralTokenPrefix: `epoch-${workerName}-setup-`
	};
}

export type ResourceNames = ReturnType<typeof resourceNames>;

/** A free-looking alternative to offer when a Worker of this name exists: `epoch` → `epoch-2` → `epoch-3`. */
export function suggestAlternativeName(workerName: string): string {
	const match = /^(.*)-(\d+)$/.exec(workerName);
	return match ? `${match[1]}-${Number(match[2]) + 1}` : `${workerName}-2`;
}

/** What a Worker name implies, shown under the name prompt. */
export function derivedNameSummary(workerName: string): string {
	const names = resourceNames(workerName);
	return `D1 ${names.d1}, R2 ${names.r2}, queue ${names.queue}, workflow ${names.workflow}, Access app "${names.accessApp}"`;
}
