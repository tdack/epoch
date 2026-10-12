import { describe, expect, it } from 'vitest';
import { DEPLOY_VALUES_VARIABLE, parseDeployValues } from '../deploy-values.ts';
import { stubApi, testContext, testManifest } from '../testing.ts';
import type { BuildTrigger, CloudflareApi } from '../cloudflare.ts';
import { BUILDS_COMMANDS, configureBuilds } from './builds.ts';

const manifest = testManifest({
	hosting: 'workers-dev',
	hostname: 'epoch.example.workers.dev',
	teamDomain: 'team.cloudflareaccess.com'
});

const production: BuildTrigger = {
	id: 'trig-prod',
	name: 'Production',
	buildCommand: BUILDS_COMMANDS.build,
	deployCommand: BUILDS_COMMANDS.deploy
};

function run(overrides: Partial<CloudflareApi>) {
	const set: { triggerId: string; variables: Record<string, string> }[] = [];
	const cf = stubApi({
		getWorkerScriptId: async () => 'a'.repeat(32),
		setBuildVariables: async (triggerId, variables) => void set.push({ triggerId, variables }),
		...overrides
	});
	const { ctx, report } = testContext({ cf });
	return configureBuilds(ctx, manifest).then((lines) => ({ lines, set, report }));
}

describe('the Workers Builds variable', () => {
	it('is set on every trigger, and holds values the build host can parse', async () => {
		const preview = { ...production, id: 'trig-preview', name: 'Preview' };
		const { lines, set } = await run({ listBuildTriggers: async () => [production, preview] });
		expect(set.map((s) => s.triggerId)).toEqual(['trig-prod', 'trig-preview']);
		const value = set[0]!.variables[DEPLOY_VALUES_VARIABLE]!;
		expect(parseDeployValues(value)).toMatchObject({
			workerName: 'epoch',
			hostname: 'epoch.example.workers.dev',
			installId: manifest.installId
		});
		expect(lines).toEqual([
			`Workers Builds: set ${DEPLOY_VALUES_VARIABLE} on "Production", "Preview".`
		]);
	});

	it('reports a trigger that still builds twice, without changing its commands', async () => {
		const old = { ...production, buildCommand: 'npm run build', deployCommand: 'npm run deploy' };
		const { lines } = await run({ listBuildTriggers: async () => [old] });
		expect(lines[1]).toContain('builds with `npm run build`');
		expect(lines[1]).toContain(BUILDS_COMMANDS.build);
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
