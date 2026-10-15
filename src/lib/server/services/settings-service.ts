import { resolvePalette, type Palette } from '#lib/shared/palette.js';
import type { DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import { applyPatch, assertContrastFloors } from '../domain/settings';
import type { SettingsDocument, SettingsPatch, SettingsView } from '#lib/shared/settings.js';
import { SettingsRepository } from '../repositories/settings-repository';
import { settingsDocumentSchema } from '../validation/schemas';
import { requireInstallOwner, requireRealUser } from './tree-access';

/** The shape of a stored document. Bumped only with a migration of the stored JSON. */
const STORED_VERSION = 1;

/**
 * Reads and writes the colour and motion choices (ADR-054). A stored document that fails to parse
 * is read as unset, so a corrupt row falls back to the layer below rather than breaking the page.
 */
export class SettingsService {
	private readonly repo: SettingsRepository;

	constructor(
		db: DbClient,
		private readonly now: () => Date = () => new Date()
	) {
		this.repo = new SettingsRepository(db);
	}

	/** What the caller sees on the settings page: their layer, the site layer, and the result. */
	async view(context: AuthenticatedContext): Promise<SettingsView> {
		const site = await this.readSite();
		const user = context.user.isPublicVisitor ? {} : await this.readUser(context.user.id);
		return { user, site, effective: effectiveOf(resolvePalette(user, site), user) };
	}

	/**
	 * The palette and motion setting every page is painted with. Anonymous readers get the site
	 * default. Used by the root layout, which must not fail a page when settings cannot be read.
	 */
	async resolveFor(userId: string | null): Promise<{ palette: Palette; isMotionReduced: boolean }> {
		const site = await this.readSite();
		const user = userId === null ? {} : await this.readUser(userId);
		return { palette: resolvePalette(user, site), isMotionReduced: user.isMotionReduced ?? false };
	}

	/** Changes the caller's own layer. A group that is null clears back to the site default. */
	async updateMine(patch: SettingsPatch, context: AuthenticatedContext): Promise<SettingsView> {
		requireRealUser(context);
		const next = applyPatch(await this.readUser(context.user.id), patch);
		assertContrastFloors(next);
		await this.repo.saveUserData(context.user.id, serialise(next), this.now());
		return this.view(context);
	}

	/** Changes the install-wide default. Motion is not a site setting, so the patch cannot carry it. */
	async updateSite(
		patch: Omit<SettingsPatch, 'isMotionReduced'>,
		context: AuthenticatedContext
	): Promise<SettingsView> {
		requireInstallOwner(context);
		const next = applyPatch(await this.readSite(), patch);
		assertContrastFloors(next);
		await this.repo.saveSiteData(serialise(next), this.now());
		return this.view(context);
	}

	private async readUser(userId: string): Promise<SettingsDocument> {
		return parseStored(await this.repo.findUserData(userId));
	}

	private async readSite(): Promise<SettingsDocument> {
		return parseStored(await this.repo.findSiteData());
	}
}

function parseStored(raw: string | null): SettingsDocument {
	if (raw === null) return {};
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return {};
	}
	const parsed = settingsDocumentSchema.safeParse(json);
	if (!parsed.success) return {};
	const { version: _version, ...document } = parsed.data;
	return document;
}

function serialise(document: SettingsDocument): string {
	return JSON.stringify({ version: STORED_VERSION, ...document });
}

function effectiveOf(palette: Palette, user: SettingsDocument): SettingsView['effective'] {
	return {
		sexColours: {
			male: palette.sex.male.border,
			female: palette.sex.female.border,
			unknown: palette.sex.unknown.border
		},
		tracePalette: { trace: [...palette.trace], intersection: palette.intersection },
		focusColours: { ...palette.focus },
		isMotionReduced: user.isMotionReduced ?? false
	};
}
