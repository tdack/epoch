import { ERROR_CODES, SetupError } from './errors.ts';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$|^[a-z0-9]$/;

export function assertValidSlug(slug: string): void {
	if (!SLUG_PATTERN.test(slug)) {
		throw new SetupError(ERROR_CODES.usage, `"${slug}" cannot be an install slug`, {
			hint: 'Use 1 to 40 lowercase letters, digits and hyphens, not starting or ending with a hyphen.',
			flag: '--slug'
		});
	}
}

/**
 * Every account-level name derives from the slug, so two checkouts with different slugs cannot
 * collide. Workflow names are per account too, which is why the workflow is derived as well.
 * With the slug `epoch-genealogy` these equal the names in the tracked wrangler.jsonc, which is
 * how the repository's own install is adopted without renaming anything.
 */
export function resourceNames(slug: string) {
	return {
		worker: slug,
		d1: `${slug}-db`,
		r2: `${slug}-media`,
		queue: `${slug}-import-queue`,
		workflow: `${slug}-export-workflow`,
		accessApp: `Epoch (${slug})`,
		accessPolicy: `Epoch ${slug} sign-in`,
		profile: `epoch-${slug}`,
		/** Prefix of the short-lived deploy tokens, so a sweep can find leftovers. */
		ephemeralTokenPrefix: `epoch-${slug}-setup-`
	};
}

export type ResourceNames = ReturnType<typeof resourceNames>;
