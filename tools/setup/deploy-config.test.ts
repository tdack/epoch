import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	generateDeployConfig,
	lineDiff,
	loadTemplate,
	parseDeployDefaults,
	parseTrackedConfig,
	renderDeployConfig,
	type DeployValues
} from './deploy-config.ts';
import { parseJsonc, stripJsonc } from './jsonc.ts';
import { resourceNames } from './names.ts';
import { installPaths } from './paths.ts';
import { memoryFs } from './testing.ts';

// The real tracked file, so a change to its shape breaks this test and not a deploy.
const tracked = parseTrackedConfig(
	readFileSync(join(import.meta.dirname, '..', '..', 'wrangler.jsonc'), 'utf8')
);

const values: DeployValues = {
	names: resourceNames('family'),
	hosting: 'custom',
	isWorkersDevKept: false,
	hostname: 'family.example.com',
	teamDomain: 'team.cloudflareaccess.com',
	installId: '11111111-1111-4111-8111-111111111111',
	d1Id: 'd1d10000-0000-4000-8000-000000000001',
	emailSender: null,
	r2Jurisdiction: null,
	accessAud: 'aud-123'
};

describe('jsonc', () => {
	it('keeps // inside strings, strips comments and trailing commas', () => {
		const text = `{
			// a comment
			"url": "https://example.com//path", /* block */
			"list": [1, 2,],
			"quote": "a \\" // not a comment",
		}`;
		expect(parseJsonc(text)).toEqual({
			url: 'https://example.com//path',
			list: [1, 2],
			quote: 'a " // not a comment'
		});
	});

	it('does not touch commas inside strings', () => {
		expect(stripJsonc('{"a": ",}"}')).toBe('{"a": ",}"}');
	});
});

describe('generateDeployConfig', () => {
	const config = generateDeployConfig(tracked, values) as Record<string, any>;

	it('renames every account-level resource from the workerName', () => {
		expect(config.name).toBe('family');
		expect(config.d1_databases[0]).toMatchObject({
			binding: 'DB',
			database_name: 'family-db',
			database_id: values.d1Id,
			migrations_dir: 'drizzle'
		});
		expect(config.r2_buckets[0].bucket_name).toBe('family-media');
		expect(config.queues.producers[0].queue).toBe('family-import-queue');
		expect(config.queues.consumers[0].queue).toBe('family-import-queue');
		expect(config.workflows[0].name).toBe('family-export-workflow');
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

	it('renders JSONC with a header that wrangler can read back', () => {
		const text = renderDeployConfig(config);
		expect(text.startsWith('// Tracked.')).toBe(true);
		expect(parseJsonc(text)).toEqual(config);
	});

	it('says what is missing when the tracked file has changed shape', () => {
		expect(() => generateDeployConfig({ name: 'x' }, values)).toThrow('d1_databases');
	});
});

describe('the template', () => {
	const paths = installPaths('/repo');
	const shipped = readFileSync(
		join(import.meta.dirname, 'templates', 'wrangler.template.jsonc'),
		'utf8'
	);
	const trackedText = readFileSync(join(import.meta.dirname, '..', '..', 'wrangler.jsonc'), 'utf8');

	/** The shape of a config with every identifier blanked, so only binding structure is compared. */
	function shape(value: unknown): unknown {
		if (Array.isArray(value)) return value.map(shape);
		if (value && typeof value === 'object')
			return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
		return typeof value;
	}

	it('keeps the shipped copy’s binding shapes equal to the tracked wrangler.jsonc', () => {
		expect(shape(parseJsonc(shipped))).toEqual(shape(parseJsonc(trackedText)));
	});

	it.each([
		['missing', undefined],
		['empty', ''],
		['unparseable', '{ not json'],
		['an empty object', '{}']
	])('falls back to the shipped copy when the tracked file is %s', (_label, text) => {
		const fs = memoryFs({
			[paths.templateFile]: shipped,
			...(text === undefined ? {} : { [paths.trackedConfigFile]: text })
		});
		const loaded = loadTemplate(fs, paths);
		expect(loaded.isFallback).toBe(true);
		expect(Array.isArray((loaded.config as any).d1_databases)).toBe(true);
	});

	it('uses the tracked file when it is usable', () => {
		const fs = memoryFs({ [paths.templateFile]: shipped, [paths.trackedConfigFile]: trackedText });
		expect(loadTemplate(fs, paths).isFallback).toBe(false);
	});
});

describe('an existing wrangler.deploy.jsonc', () => {
	it('supplies defaults', () => {
		const text =
			'// c\n{"name":"shop","workers_dev":false,"routes":[{"pattern":"shop.example.com","custom_domain":true}],"vars":{"CF_ACCESS_TEAM_DOMAIN":"t.cloudflareaccess.com","EPOCH_INSTALL_ID":"i"},"d1_databases":[{"database_id":"d1"}]}';
		expect(parseDeployDefaults(text)).toEqual({
			workerName: 'shop',
			hostname: 'shop.example.com',
			hosting: 'custom',
			isWorkersDevKept: false,
			d1Id: 'd1',
			teamDomain: 't.cloudflareaccess.com',
			installId: 'i',
			emailSender: null
		});
		expect(parseDeployDefaults('{"name":"x","workers_dev":true}')).toMatchObject({
			hosting: 'workers-dev',
			workerName: 'x'
		});
	});

	it.each([[null], [''], ['  '], ['{ broken'], ['[]']])(
		'means no defaults when it is %j',
		(text) => {
			expect(parseDeployDefaults(text)).toMatchObject({
				workerName: null,
				hostname: null,
				hosting: null
			});
		}
	);

	it('shows a diff of what regenerating changes', () => {
		expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual(['- b', '+ x']);
		expect(lineDiff('same', 'same')).toEqual([]);
	});
});
