import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lineDiff, loadTemplate, parseDeployDefaults } from './deploy-config.ts';
import { parseJsonc, stripJsonc } from './jsonc.ts';
import { installPaths } from './paths.ts';
import { memoryFs } from './testing.ts';

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
			emailSender: null,
			treeHostZone: null,
			reservedSubdomains: [],
			appHost: null
		});
		expect(parseDeployDefaults('{"name":"x","workers_dev":true}')).toMatchObject({
			hosting: 'workers-dev',
			workerName: 'x'
		});
	});

	it('reads the custom domain beside the tree subdomains’ route, and their vars', () => {
		const text = JSON.stringify({
			name: 'shop',
			workers_dev: false,
			routes: [
				{ pattern: '*.example.com/*', zone_name: 'example.com' },
				{ pattern: 'example.com', custom_domain: true }
			],
			vars: {
				EPOCH_TREE_HOST_ZONE: 'example.com',
				EPOCH_RESERVED_SUBDOMAINS: 'demo, www',
				EPOCH_APP_HOST: 'epoch.example.com'
			}
		});
		expect(parseDeployDefaults(text)).toMatchObject({
			hostname: 'example.com',
			hosting: 'custom',
			treeHostZone: 'example.com',
			reservedSubdomains: ['demo', 'www'],
			appHost: 'epoch.example.com'
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
