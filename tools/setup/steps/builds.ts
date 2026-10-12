import type { BuildTrigger, BuildTriggerSettings } from '../cloudflare.ts';
import type { StepContext } from '../context.ts';
import { DEPLOY_VALUES_VARIABLE, serialiseDeployValues } from '../deploy-values.ts';
import type { Manifest } from '../manifest.ts';
import { resourceNames } from '../names.ts';
import { deployValuesOf } from './write-config.ts';

/**
 * The production trigger as ADR-043 wants it: commands that build once and read the build
 * variable, and a build only when `src/` changes (the owner's choice), so documentation and tooling
 * pushes cost no build minutes. A push touching only drizzle/, workers/, static/, wrangler.jsonc or
 * package.json therefore does not deploy; `npm run deploy` or a push touching `src/` does.
 */
export const PRODUCTION_TRIGGER: BuildTriggerSettings = {
	buildCommand: 'npm run build:worker',
	deployCommand: 'npm run deploy:worker',
	pathIncludes: ['src/**'],
	pathExcludes: ['node_modules/**', '.git/', 'docs/', '.agents/', '.claude/']
};

/**
 * Gives Workers Builds this install's values as the one build variable `npm run build:worker`
 * turns into `wrangler.deploy.jsonc`. Never fails the run: the Worker is already deployed by
 * the time this runs, and every way it can fall short ends in lines saying what to paste where.
 * Only the production trigger's commands and paths are changed: a preview trigger's deploy command
 * uploads a version, and making it `deploy:worker` would send every branch to production.
 */
export async function configureBuilds(ctx: StepContext, manifest: Manifest): Promise<string[]> {
	const worker = resourceNames(manifest.workerName).worker;
	const value = serialiseDeployValues(deployValuesOf(manifest));
	const byHand = [
		`In the dashboard (Workers & Pages → ${worker} → Settings → Builds), add the build variable ${DEPLOY_VALUES_VARIABLE} with the value:`,
		value,
		`and set the build command to \`${PRODUCTION_TRIGGER.buildCommand}\`, the deploy command to \`${PRODUCTION_TRIGGER.deployCommand}\` and the build watch paths to include ${PRODUCTION_TRIGGER.pathIncludes.join(', ')} and exclude ${PRODUCTION_TRIGGER.pathExcludes.join(', ')}.`
	];

	let triggers;
	try {
		const scriptId = await ctx.cf.getWorkerScriptId(worker);
		if (scriptId === null) {
			return [
				`Workers Builds: the Worker ${worker} is not deployed yet, so it cannot be connected.`
			];
		}
		triggers = await ctx.cf.listBuildTriggers(scriptId);
	} catch (error) {
		ctx.report.warn(`Could not read the Workers Builds settings: ${(error as Error).message}`);
		return ['Workers Builds: to deploy on every push,', ...byHand];
	}
	if (triggers.length === 0) {
		return [
			'Workers Builds is not connected. To deploy on every push, connect the repository',
			...byHand,
			'or connect it first and then run `./setup builds`.'
		];
	}

	try {
		for (const trigger of triggers) {
			await ctx.cf.setBuildVariables(trigger.id, { [DEPLOY_VALUES_VARIABLE]: value });
		}
	} catch (error) {
		ctx.report.warn(`Could not set the Workers Builds variable: ${(error as Error).message}`);
		return ['Workers Builds:', ...byHand];
	}

	const lines = [
		`Workers Builds: set ${DEPLOY_VALUES_VARIABLE} on ${triggers.map(label).join(', ')}.`
	];
	const productions = triggers.filter(isProduction);
	const production = productions.length === 1 ? productions[0]! : null;
	if (production && !isCurrent(production)) {
		try {
			await ctx.cf.updateBuildTrigger(production.id, PRODUCTION_TRIGGER);
			lines.push(
				`Workers Builds: ${label(production)} now builds with \`${PRODUCTION_TRIGGER.buildCommand}\` and deploys with \`${PRODUCTION_TRIGGER.deployCommand}\`, for changes to ${PRODUCTION_TRIGGER.pathIncludes.join(', ')}.`
			);
		} catch (error) {
			ctx.report.warn(`Could not set the Workers Builds commands: ${(error as Error).message}`);
			lines.push(
				`Set ${label(production)}'s build command to \`${PRODUCTION_TRIGGER.buildCommand}\`, its deploy command to \`${PRODUCTION_TRIGGER.deployCommand}\` and its watch paths to include ${PRODUCTION_TRIGGER.pathIncludes.join(', ')}.`
			);
		}
	}
	const unchanged = triggers.filter(
		(t) => t !== production && t.buildCommand !== PRODUCTION_TRIGGER.buildCommand
	);
	if (unchanged.length > 0) {
		lines.push(
			`${unchanged.map(label).join(', ')} still builds with \`${unchanged[0]!.buildCommand ?? '(none)'}\`; set its build command to \`${PRODUCTION_TRIGGER.buildCommand}\` (setup changes only a single production trigger).`
		);
	}
	return lines;
}

/** A production trigger names branches; a preview one matches them with a pattern. */
function isProduction(trigger: BuildTrigger): boolean {
	return trigger.branchIncludes.length > 0 && !trigger.branchIncludes.some((b) => b.includes('*'));
}

function isCurrent(trigger: BuildTrigger): boolean {
	const same = (a: readonly string[], b: readonly string[]) =>
		a.length === b.length && a.every((value, index) => value === b[index]);
	return (
		trigger.buildCommand === PRODUCTION_TRIGGER.buildCommand &&
		trigger.deployCommand === PRODUCTION_TRIGGER.deployCommand &&
		same(trigger.pathIncludes, PRODUCTION_TRIGGER.pathIncludes) &&
		same(trigger.pathExcludes, PRODUCTION_TRIGGER.pathExcludes)
	);
}

/** The dashboard names a trigger after the script id, which says nothing, so it is described by branch. */
function label(trigger: BuildTrigger): string {
	const branches = trigger.branchIncludes.join(', ');
	return isProduction(trigger)
		? `production (${branches})`
		: `preview (${branches || 'any branch'})`;
}
