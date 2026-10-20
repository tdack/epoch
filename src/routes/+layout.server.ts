import { DEFAULT_PALETTE, type Palette } from '#lib/shared/palette.js';
import { getDb } from '#lib/server/db/index.js';
import { Logger } from '#lib/server/logging/logger.js';
import { ProfileService } from '#lib/server/services/profile-service.js';
import type { ProfileViewDto } from '#lib/shared/profile.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { SOURCE_COMMIT, sourceUrl } from '#lib/server/source-url.js';
import { SETTINGS_DEPENDENCY } from '#lib/shared/settings.js';
import { treeHostConfig } from '#lib/server/http/tree-host.js';
import type { LayoutServerLoad } from './$types';

/**
 * What every page needs from the server: where its source can be had (AGPL section 13), the
 * colours and motion setting it is painted with (ADR-054), who is signed in for the header's avatar, and, on a tree's own subdomain, which
 * tree that is and where the rest of the install lives.
 */
export const load: LayoutServerLoad = async ({ platform, locals, depends }) => {
	depends(SETTINGS_DEPENDENCY);
	return {
		sourceUrl: sourceUrl(platform?.env),
		sourceCommit: SOURCE_COMMIT,
		hostTree: locals.hostTree,
		/** The zone tree subdomains sit under; null when this install serves none. */
		subdomainZone: treeHostConfig(platform?.env)?.zone ?? null,
		viewer: await viewerOf(platform?.env?.DB, locals),
		...(await appearance(platform?.env?.DB, locals))
	};
};

/**
 * The caller's palette. The public visitor and anyone signed out get the site default. A failure
 * to read settings must not take a page down: colours are cosmetic, so it falls back to the
 * built-in palette and logs.
 */
async function appearance(
	d1: App.Platform['env']['DB'] | undefined,
	locals: App.Locals
): Promise<{ palette: Palette; isMotionReduced: boolean }> {
	const fallback = { palette: DEFAULT_PALETTE, isMotionReduced: false };
	if (!d1) return fallback;
	const user = locals.user;
	const userId = user && !user.isPublicVisitor ? user.id : null;
	try {
		return await new SettingsService(getDb(d1)).resolveFor(userId);
	} catch (error) {
		new Logger({ correlationId: locals.correlationId }).warn('Could not read settings', {
			error: error instanceof Error ? error.message : String(error)
		});
		return fallback;
	}
}

/**
 * Who the header's avatar shows, or null for the public visitor and anyone signed out. A failed
 * read falls back to initials from the identity the request already holds, so the menu, and with it
 * Sign out, never disappears because the profile could not be read.
 */
async function viewerOf(
	d1: App.Platform['env']['DB'] | undefined,
	locals: App.Locals
): Promise<ProfileViewDto | null> {
	const user = locals.user;
	if (!user || user.isPublicVisitor) return null;
	const fallback = {
		email: user.email,
		name: user.name ?? null,
		avatarUrl: null,
		canUseAccessPicture: false
	};
	if (!d1) return fallback;
	try {
		return await new ProfileService(getDb(d1)).view({
			user,
			correlationId: locals.correlationId
		});
	} catch (error) {
		new Logger({ correlationId: locals.correlationId }).warn('Could not read the profile', {
			error: error instanceof Error ? error.message : String(error)
		});
		return fallback;
	}
}
