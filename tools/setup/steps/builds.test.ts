import { describe, expect, it } from 'vitest';
import { DEPLOY_VALUES_VARIABLE, parseDeployValues } from '../deploy-values.ts';
import { stubApi, testContext, testManifest } from '../testing.ts';
import type { BuildTrigger, CloudflareApi } from '../cloudflare.ts';
import { PRODUCTION_TRIGGER, configureBuilds } from './builds.ts';

const manifest = testManifest({
	hosting: 'workers-dev',
	hostname: 'epoch.example.workers.dev',
	teamDomain: 'team.cloudflareaccess.com'
});

const production: BuildTrigger = {
	id: 'trig-prod',
	name: 'a'.repeat(32),
	buildCommand: PRODUCTION_TRIGGER.buildCommand,
	deployCommand: PRODUCTION_TRIGGER.deployCommand,
	branchIncludes: ['main'],
	pathIncludes: [...PRODUCTION_TRIGGER.pathIncludes],
	pathExcludes: [...PRODUCTION_TRIGGER.pathExcludes]
};
const preview: BuildTrigger = {
	...production,
	id: 'trig-preview',
	buildCommand: 'npm run build',
	deployCommand: 'npx wrangler versions upload',
	branchIncludes: ['*'],
	pathIncludes: ['*'],
	pathExcludes: []
};

function run(overrides: Partial<CloudflareApi>) {
	const set: { triggerId: string; variables: Record<string, string> }[] = [];
	const commands: string[] = [];
	const cf = stubApi({
		getWorkerScriptId: async () => 'a'.repeat(32),
		setBuildVariables: async (triggerId, variables) => void set.push({ triggerId, variables }),
		updateBuildTrigger: async (triggerId) => void commands.push(triggerId),
		...overrides
	});
	const { ctx, report } = testContext({ cf });
	return configureBuilds(ctx, manifest).then((lines) => ({ lines, set, commands, report }));
}

describe('the Workers Builds variable', () => {
	it('is set on every trigger, and holds values the build host can parse', async () => {
		const current = { ...preview, buildCommand: PRODUCTION_TRIGGER.buildCommand };
		const { lines, set, commands } = await run({
			listBuildTriggers: async () => [production, current]
		});
		expect(set.map((s) => s.triggerId)).toEqual(['trig-prod', 'trig-preview']);
		expect(commands).toEqual([]);
		const value = set[0]!.variables[DEPLOY_VALUES_VARIABLE]!;
		expect(parseDeployValues(value)).toMatchObject({
			workerName: 'epoch',
			hostname: 'epoch.example.workers.dev',
			installId: manifest.installId
		});
		expect(lines).toEqual([
			`Workers Builds: set ${DEPLOY_VALUES_VARIABLE} on production (main), preview (*).`
		]);
	});

	it('points the production trigger at the build-once commands, and leaves a preview alone', async () => {
		const old = { ...production, buildCommand: 'npm run build', deployCommand: 'npm run deploy' };
		const { lines, commands } = await run({ listBuildTriggers: async () => [old, preview] });
		expect(commands).toEqual(['trig-prod']);
		expect(lines[1]).toContain('production (main) now builds with');
		expect(lines[2]).toContain('preview (*) still builds with `npm run build`');
	});

	it('changes no commands when it cannot tell which trigger is production', async () => {
		const old = { ...production, buildCommand: 'npm run build' };
		const { lines, commands } = await run({
			listBuildTriggers: async () => [
				old,
				{ ...old, id: 'trig-other', branchIncludes: ['release'] }
			]
		});
		expect(commands).toEqual([]);
		expect(lines[1]).toContain('still builds with `npm run build`');
	});

	it('says what to set by hand when the commands cannot be changed', async () => {
		const old = { ...production, deployCommand: 'npm run deploy' };
		const { lines, report } = await run({
			listBuildTriggers: async () => [old],
			updateBuildTrigger: async () => {
				throw new Error('403 Forbidden');
			}
		});
		expect(report.warnings[0]).toContain('403 Forbidden');
		expect(lines[1]).toContain(`deploy command to \`${PRODUCTION_TRIGGER.deployCommand}\``);
	});

	it('narrows the production trigger to src/ when it builds for every path', async () => {
		const wide = { ...production, pathIncludes: ['*'], pathExcludes: [] };
		const { lines, commands } = await run({ listBuildTriggers: async () => [wide] });
		expect(commands).toEqual(['trig-prod']);
		expect(lines[1]).toContain('for changes to src/**');
	});

	it('says how to connect, and what to paste, when the repository is not connected', async () => {
		const { lines, set } = await run({ listBuildTriggers: async () => [] });
		expect(set).toEqual([]);
		expect(lines[0]).toContain('not connected');
		expect(lines.some((line) => line.startsWith('{"workerName":"epoch"'))).toBe(true);
		expect(lines.at(-1)).toContain('./setup builds');
	});

	it('falls back to the value to paste when the sign-in cannot reach the Builds API', async () => {
		const { lines, report } = await run({
			listBuildTriggers: async () => [production],
			setBuildVariables: async () => {
				throw new Error('403 Forbidden');
			}
		});
		expect(report.warnings[0]).toContain('403 Forbidden');
		expect(lines.some((line) => line.includes(DEPLOY_VALUES_VARIABLE))).toBe(true);
		expect(lines.some((line) => line.startsWith('{'))).toBe(true);
	});

	it('does nothing before the Worker exists', async () => {
		const { lines } = await run({ getWorkerScriptId: async () => null });
		expect(lines[0]).toContain('not deployed yet');
	});
});
