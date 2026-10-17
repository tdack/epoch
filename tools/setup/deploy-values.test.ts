import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTrackedConfig } from './deploy-config.ts';
import {
	generateDeployConfig,
	parseDeployValues,
	serialiseDeployValues,
	type DeployValues
} from './deploy-values.ts';

// The real tracked file, so a change to its shape breaks this test and not a deploy.
const tracked = parseTrackedConfig(
	readFileSync(join(import.meta.dirname, '..', '..', 'wrangler.jsonc'), 'utf8')
);

const values: DeployValues = {
	workerName: 'family',
	hosting: 'custom',
	isWorkersDevKept: false,
	hostname: 'family.example.com',
	teamDomain: 'team.cloudflareaccess.com',
	installId: '11111111-1111-4111-8111-111111111111',
	emailSender: null,
	r2Jurisdiction: null,
	accessAud: 'aud-123',
	treeHostZone: null,
	reservedSubdomains: [],
	appHost: null
};

describe('generateDeployConfig', () => {
	const config = generateDeployConfig(tracked, values) as Record<string, any>;

	it('renames every account-level resource from the workerName', () => {
		expect(config.name).toBe('family');
		expect(config.d1_databases[0]).toMatchObject({
			binding: 'DB',
			database_name: 'family-db',
			migrations_dir: 'drizzle'
		});
		expect(config.r2_buckets[0].bucket_name).toBe('family-media');
		expect(config.queues.producers[0].queue).toBe('family-import-queue');
		expect(config.queues.consumers[0].queue).toBe('family-import-queue');
		expect(config.workflows[0].name).toBe('family-export-workflow');
	});

	it('names the database but never its id: wrangler resolves it by name', () => {
		expect(config.d1_databases[0]).not.toHaveProperty('database_id', expect.anything());
		const stale = structuredClone(tracked) as Record<string, any>;
		stale.d1_databases[0].database_id = 'd1d10000-0000-4000-8000-000000000001';
		const fixed = generateDeployConfig(stale, values) as Record<string, any>;
		expect(JSON.parse(JSON.stringify(fixed)).d1_databases[0].database_id).toBeUndefined();
	});

	it('adds the route, the vars and the install id, with the AUD as a var', () => {
		expect(config.routes).toEqual([{ pattern: 'family.example.com', custom_domain: true }]);
		expect(config.vars).toMatchObject({
			CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
			EPOCH_INSTALL_ID: values.installId,
			CF_ACCESS_AUD: 'aud-123'
		});
	});

	it('leaves the AUD out of vars when the install keeps it as a secret', () => {
		const adopted = generateDeployConfig(tracked, { ...values, accessAud: null }) as Record<
			string,
			any
		>;
		expect(adopted.vars.CF_ACCESS_AUD).toBeUndefined();
	});

	it('leaves send_email out unless the sender domain is verified', () => {
		expect(config.send_email).toBeUndefined();
		const withSender = generateDeployConfig(tracked, {
			...values,
			emailSender: 'welcome@example.com'
		}) as Record<string, any>;
		expect(withSender.send_email[0]).toMatchObject({
			name: 'EMAIL',
			allowed_sender_addresses: ['welcome@example.com']
		});
		expect(withSender.vars.EPOCH_EMAIL_SENDER).toBe('welcome@example.com');
		expect((config as Record<string, any>).vars.EPOCH_EMAIL_SENDER).toBeUndefined();
	});

	it('writes the R2 jurisdiction only when one was chosen', () => {
		expect(config.r2_buckets[0].jurisdiction).toBeUndefined();
		const eu = generateDeployConfig(tracked, { ...values, r2Jurisdiction: 'eu' }) as Record<
			string,
			any
		>;
		expect(eu.r2_buckets[0].jurisdiction).toBe('eu');
	});

	it('does not mutate the tracked config', () => {
		expect((tracked as Record<string, any>).d1_databases[0].database_name).not.toBe('family-db');
	});

	it('workers.dev only: workers_dev on and no route', () => {
		const only = generateDeployConfig(tracked, {
			...values,
			hosting: 'workers-dev',
			hostname: 'family.me.workers.dev'
		}) as Record<string, any>;
		expect(only.workers_dev).toBe(true);
		expect(only.routes).toBeUndefined();
	});

	it('custom domain: workers.dev and preview URLs off unless kept', () => {
		expect(config.workers_dev).toBe(false);
		expect(config.preview_urls).toBe(false);
		const kept = generateDeployConfig(tracked, { ...values, isWorkersDevKept: true }) as Record<
			string,
			any
		>;
		expect(kept.workers_dev).toBe(true);
		expect(kept.preview_urls).toBeUndefined();
	});

	describe('tree subdomains (ADR-057)', () => {
		const trees: DeployValues = {
			...values,
			hostname: 'example.com',
			treeHostZone: 'example.com',
			reservedSubdomains: ['www', 'demo', 'www'],
			appHost: null
		};

		it('adds the wildcard route beside the custom domain, and the vars', () => {
			const on = generateDeployConfig(tracked, trees) as Record<string, any>;
			expect(on.routes).toEqual([
				{ pattern: 'example.com', custom_domain: true },
				{ pattern: '*.example.com/*', zone_name: 'example.com' }
			]);
			expect(on.vars).toMatchObject({
				EPOCH_TREE_HOST_ZONE: 'example.com',
				EPOCH_RESERVED_SUBDOMAINS: 'demo,www'
			});
			expect(on.vars).not.toHaveProperty('EPOCH_APP_HOST');
		});

		it('names the app host only when it is not the zone apex', () => {
			const beside = generateDeployConfig(tracked, {
				...trees,
				hostname: 'epoch.example.com',
				appHost: 'epoch.example.com'
			}) as Record<string, any>;
			expect(beside.vars.EPOCH_APP_HOST).toBe('epoch.example.com');
		});

		it('leaves every one of them out without a zone', () => {
			expect(config.routes).toHaveLength(1);
			for (const key of ['EPOCH_TREE_HOST_ZONE', 'EPOCH_RESERVED_SUBDOMAINS', 'EPOCH_APP_HOST'])
				expect(config.vars).not.toHaveProperty(key);
		});

		it('round-trip through the build variable, with the labels sorted once', () => {
			expect(parseDeployValues(serialiseDeployValues(trees))).toEqual({
				...trees,
				reservedSubdomains: ['demo', 'www']
			});
		});
	});

	it('says what is missing when the tracked file has changed shape', () => {
		expect(() => generateDeployConfig({ name: 'x' }, values)).toThrow('d1_databases');
	});
});

describe('the EPOCH_DEPLOY_VALUES build variable', () => {
	it('round-trips', () => {
		expect(parseDeployValues(serialiseDeployValues(values))).toEqual(values);
	});

	it('serialises in a fixed order, so an unchanged install upserts the same text', () => {
		const reordered = Object.fromEntries(Object.entries(values).reverse()) as DeployValues;
		expect(serialiseDeployValues(reordered)).toBe(serialiseDeployValues(values));
	});

	it('leaves an install without subdomains with the variable it had before them', () => {
		expect(serialiseDeployValues(values)).not.toContain('treeHost');
	});

	it('parses a variable set before subdomains existed, with the feature off', () => {
		const old = JSON.stringify({
			workerName: 'family',
			hosting: 'custom',
			hostname: 'family.example.com',
			isWorkersDevKept: false,
			teamDomain: 'team.cloudflareaccess.com',
			installId: values.installId,
			emailSender: null,
			r2Jurisdiction: null,
			accessAud: 'aud-123'
		});
		expect(parseDeployValues(old)).toEqual(values);
	});

	it('fits the 5000-character limit on a build variable with room to spare', () => {
		expect(serialiseDeployValues(values).length).toBeLessThan(1000);
	});

	it.each([
		['not JSON', '{', 'is not JSON'],
		['an array', '[]', 'is not a JSON object'],
		['no workerName', JSON.stringify({ ...values, workerName: '' }), 'lacks "workerName"'],
		['an unknown hosting', JSON.stringify({ ...values, hosting: 'pages' }), 'unknown hosting'],
		['a numeric sender', JSON.stringify({ ...values, emailSender: 5 }), 'non-string "emailSender"'],
		[
			'reserved labels that are not a list',
			JSON.stringify({ ...values, treeHostZone: 'example.com', reservedSubdomains: 'www' }),
			'"reservedSubdomains"'
		]
	])('refuses %s', (_label, text, message) => {
		expect(() => parseDeployValues(text)).toThrow(message);
	});

	it('refuses a Worker name setup would refuse', () => {
		expect(() => parseDeployValues(JSON.stringify({ ...values, workerName: 'Not Valid' }))).toThrow(
			'cannot be an install workerName'
		);
	});
});
