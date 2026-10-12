import type { StepContext } from '../context.ts';
import { DEPLOY_VALUES_VARIABLE, serialiseDeployValues } from '../deploy-values.ts';
import type { Manifest } from '../manifest.ts';
import { resourceNames } from '../names.ts';
import { deployValuesOf } from './write-config.ts';

/** The Workers Builds commands that build once and read the build variable (ADR-040). */
export const BUILDS_COMMANDS = {
	build: 'npm run build:worker',
	deploy: 'npm run deploy:worker'
} as const;

/**
 * Gives Workers Builds this install's values as the one build variable `npm run build:worker`
 * turns into `wrangler.deploy.jsonc`. Never fails the run: the Worker is already deployed by
 * the time this runs, and every way it can fall short ends in lines saying what to paste where.
 * The build and deploy commands are only reported, never changed: a preview trigger's deploy
 * command must not become one that deploys to production.
 */
export async function configureBuilds(ctx: StepContext, manifest: Manifest): Promise<string[]> {
	const worker = resourceNames(manifest.workerName).worker;
	const value = serialiseDeployValues(deployValuesOf(manifest));
	const byHand = [
		`In the dashboard (Workers & Pages → ${worker} → Settings → Builds), add the build variable ${DEPLOY_VALUES_VARIABLE} with the value:`,
		value,
		`and set the build command to \`${BUILDS_COMMANDS.build}\` and the deploy command to \`${BUILDS_COMMANDS.deploy}\`.`
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
		`Workers Builds: set ${DEPLOY_VALUES_VARIABLE} on ${triggers.map((t) => `"${t.name}"`).join(', ')}.`
	];
	const stale = triggers.filter((t) => t.buildCommand !== BUILDS_COMMANDS.build);
	if (stale.length > 0) {
		lines.push(
			`${stale.map((t) => `"${t.name}"`).join(', ')} builds with \`${stale[0]!.buildCommand ?? '(none)'}\`; set the build command to \`${BUILDS_COMMANDS.build}\`, and the production deploy command to \`${BUILDS_COMMANDS.deploy}\`, so the Worker is built once.`
		);
	}
	return lines;
}
