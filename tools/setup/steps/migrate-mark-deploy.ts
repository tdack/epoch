import type { StepContext } from '../context.ts';
import { readEnvToken } from '../env-token.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import {
	insertMarkerSql,
	isMissingTable,
	parseMarkerRows,
	readMarkerSql,
	updateOwnerSql
} from '../install-meta.ts';
import { AUTH_MODES, withMarker, withStepDone, type Manifest } from '../manifest.ts';
import { resourceNames } from '../names.ts';
import { TAG_STATES, tagResources } from '../tags.ts';
import type { WranglerApi, WranglerAuth } from '../wrangler.ts';
import { R2_MARKER_KEY } from './reconcile.ts';

const EPHEMERAL_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/** Tokens left by an earlier interrupted run. Needs the broad scope, so it only runs when we have it. */
async function sweepStaleTokens(ctx: StepContext, prefix: string): Promise<void> {
	try {
		for (const token of await ctx.cf.listTokens()) {
			if (token.name.startsWith(prefix)) await ctx.cf.deleteToken(token.id);
		}
	} catch {
		// Without account_api_tokens scope there can be no such tokens either.
	}
}

async function withDeployAuth<T>(
	ctx: StepContext,
	manifest: Manifest,
	use: (wrangler: WranglerApi) => Promise<T>
): Promise<T> {
	const accountId = manifest.account?.id ?? '';
	const names = resourceNames(manifest.workerName);
	if (manifest.authMode === AUTH_MODES.profile) {
		return use(ctx.makeWrangler({ kind: 'profile', accountId }));
	}
	if (manifest.authMode === AUTH_MODES.envToken) {
		const token = readEnvToken(ctx.env, ctx.fs, ctx.paths.envFile);
		if (!token)
			throw new SetupError(ERROR_CODES.environmentToken, 'CLOUDFLARE_API_TOKEN has gone missing');
		return use(ctx.makeWrangler({ kind: 'token', token, accountId }));
	}
	await sweepStaleTokens(ctx, names.ephemeralTokenPrefix);
	const minted = await ctx.cf.mintDeployToken(
		`${names.ephemeralTokenPrefix}${ctx.now().getTime()}`,
		new Date(ctx.now().getTime() + EPHEMERAL_TOKEN_LIFETIME_MS),
		manifest.zone?.id ?? ''
	);
	// Ctrl-C kills the process before a `finally` runs, so the registry also deletes it from a signal handler.
	const forget = ctx.cleanup.add('delete the minted deploy token', () =>
		ctx.cf.deleteToken(minted.id)
	);
	try {
		const auth: WranglerAuth = { kind: 'token', token: minted.value, accountId };
		return await use(ctx.makeWrangler(auth));
	} finally {
		await ctx.cf.deleteToken(minted.id);
		forget();
	}
}

/** Writes the D1 row idempotently and confirms it reads back as this install. */
async function writeD1Marker(ctx: StepContext, manifest: Manifest): Promise<boolean> {
	const d1 = manifest.resources.d1;
	if (!d1 || !manifest.ownerEmail) return false;
	const meta = { installId: manifest.installId, ownerEmail: manifest.ownerEmail };
	try {
		await ctx.cf.queryD1(d1.id, insertMarkerSql(meta, ctx.now()));
		await ctx.cf.queryD1(d1.id, updateOwnerSql(meta));
		const stored = parseMarkerRows(await ctx.cf.queryD1(d1.id, readMarkerSql()));
		if (stored?.installId !== manifest.installId) {
			throw new SetupError(
				ERROR_CODES.foreign,
				`${d1.name} already holds a marker for install ${stored?.installId ?? 'unknown'}`,
				{
					hint: 'It belongs to another install; use another --name.'
				}
			);
		}
		return true;
	} catch (error) {
		if (error instanceof SetupError) throw error;
		// Migration 0025 not in this checkout yet: the marker is pending, not a failure.
		if (isMissingTable(String((error as Error).message))) {
			ctx.report.warn(
				'The install_meta table does not exist yet, so the D1 marker is pending; pull the install-owner migration and re-run setup'
			);
			return false;
		}
		throw error;
	}
}

/** Plan step 9: migrate, mark, build, deploy. The only step that changes the live Worker. */
export async function migrateMarkDeploy(ctx: StepContext, manifest: Manifest): Promise<Manifest> {
	const names = resourceNames(manifest.workerName);
	const r2 = manifest.resources.r2;
	let current = manifest;

	await withDeployAuth(ctx, current, async (wrangler) => {
		await wrangler.migrate(ctx.paths.deployConfigFile);

		current = ctx.save(withMarker(current, 'd1', await writeD1Marker(ctx, current)));
		if (r2) {
			await wrangler.putObject(
				r2.name,
				R2_MARKER_KEY,
				JSON.stringify({ installId: current.installId, workerName: current.workerName })
			);
			current = ctx.save(withMarker(current, 'r2', true));
		}

		await wrangler.build();
		await wrangler.deploy(ctx.paths.deployConfigFile);
	});

	// The Worker's marker is the EPOCH_INSTALL_ID var in the config that was just deployed.
	current = ctx.save(
		withMarker(
			{ ...current, resources: { ...current.resources, worker: { name: names.worker } } },
			'worker',
			true
		)
	);
	// The Worker did not exist before this deploy, so this is the first moment it can be tagged.
	current = await tagResources(ctx, current, ['worker'], TAG_STATES.provisioning);
	return ctx.save(withStepDone(current, 'migrate-mark-deploy'));
}
