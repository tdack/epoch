import { DEFAULT_PALETTE, type Palette } from '#lib/components/tree/palette.js';
import { getDb } from '#lib/server/db/index.js';
import { Logger } from '#lib/server/logging/logger.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { SOURCE_COMMIT, sourceUrl } from '#lib/server/source-url.js';
import { SETTINGS_DEPENDENCY } from '#lib/shared/settings.js';
import type { LayoutServerLoad } from './$types';

/**
 * What every page needs from the server: where its source can be had (AGPL section 13), and the
 * colours and motion setting it is painted with (ADR-054).
 */
export const load: LayoutServerLoad = async ({ platform, locals, depends }) => {
	depends(SETTINGS_DEPENDENCY);
	return {
		sourceUrl: sourceUrl(platform?.env),
		sourceCommit: SOURCE_COMMIT,
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
