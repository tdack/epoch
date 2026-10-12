import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import { lineDiff, parseTrackedConfig } from './deploy-config.ts';
import { generateDeployConfig, type DeployValues } from './deploy-values.ts';
import { editConfigText, formatWithRepoConfig } from './edit-config.ts';
import { parseJsonc } from './jsonc.ts';

const root = join(import.meta.dirname, '..', '..');
// A deploy file as setup writes it, with placeholder values: the real one is git-ignored (ADR-040).
const committed = readFileSync(
	join(import.meta.dirname, 'fixtures', 'deploy-config.jsonc'),
	'utf8'
);
const templateText = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
const template = parseTrackedConfig(templateText);
const live = parseJsonc(committed) as any;

const values: DeployValues = {
	workerName: 'epoch-genealogy',
	hosting: 'workers-dev',
	hostname: 'epoch-genealogy.example.workers.dev',
	isWorkersDevKept: false,
	teamDomain: live.vars.CF_ACCESS_TEAM_DOMAIN,
	installId: live.vars.EPOCH_INSTALL_ID,
	emailSender: live.send_email?.[0]?.allowed_sender_addresses?.[0] ?? null,
	r2Jurisdiction: null,
	accessAud: live.vars.CF_ACCESS_AUD ?? null
};
const wanted = (over: Partial<DeployValues> = {}) =>
	generateDeployConfig(template, { ...values, ...over });
const changed = (before: string, after: string) => lineDiff(before, after);
const isFormatted = (text: string) =>
	prettier.check(text, {
		...{ useTabs: true, singleQuote: true, printWidth: 100, trailingComma: 'none' as const },
		parser: 'jsonc'
	});

describe('editing the deploy config in place', () => {
	it('unchanged values leave the committed file byte-identical, comments and all', () => {
		expect(editConfigText(committed, templateText, wanted())).toBe(committed);
	});

	it('changing one value changes only that line, and the comments survive', () => {
		const next = editConfigText(
			committed,
			templateText,
			wanted({ installId: '11111111-1111-4111-8111-111111111111' })
		);
		expect(changed(committed, next)).toEqual([
			`- \t\t"EPOCH_INSTALL_ID": "${values.installId}"`,
			'+ \t\t"EPOCH_INSTALL_ID": "11111111-1111-4111-8111-111111111111"'
		]);
		expect(next).toContain('// Serve on workers.dev only:');
		expect(next.startsWith(committed.split('\n')[0]!)).toBe(true);
	});

	it('adds send_email to a file without it', async () => {
		const without = editConfigText(committed, templateText, wanted({ emailSender: null }));
		expect(without).not.toContain('"send_email"');
		const added = editConfigText(
			without,
			templateText,
			wanted({ emailSender: 'welcome@example.com' })
		);
		expect((parseJsonc(added) as any).send_email[0].allowed_sender_addresses).toEqual([
			'welcome@example.com'
		]);
		expect(added).toContain('// Serve on workers.dev only:');
	});

	it('removing a binding takes its lines and leaves the surrounding comments', () => {
		const withSender = editConfigText(
			committed,
			templateText,
			wanted({ emailSender: 'welcome@example.com' })
		);
		const removed = editConfigText(withSender, templateText, wanted({ emailSender: null }));
		expect(removed).not.toContain('send_email');
		expect(removed).toContain('// Serve on workers.dev only:');
		expect(removed).toContain('"observability"');
	});

	it('moving to a custom domain adds the route and drops nothing else', () => {
		const next = editConfigText(
			committed,
			templateText,
			wanted({ hosting: 'custom', hostname: 'epoch.example.com' })
		);
		const config = parseJsonc(next) as any;
		expect(config.routes).toEqual([{ pattern: 'epoch.example.com', custom_domain: true }]);
		expect(config.workers_dev).toBe(false);
		expect(next).toContain('// Or on a custom domain instead');
	});

	it('creates a file from the template under the generator’s header when there is none', () => {
		const text = editConfigText(null, templateText, wanted());
		expect(text.startsWith('// Git-ignored (ADR-040). `npm run setup` regenerates')).toBe(true);
		expect(parseJsonc(text)).toEqual(wanted());
	});

	it('leaves keys the owner added by hand', () => {
		const withExtra = committed.replace(
			'"observability"',
			'"placement": { "mode": "smart" },\n\t"observability"'
		);
		const next = editConfigText(withExtra, templateText, wanted());
		expect((parseJsonc(next) as any).placement).toEqual({ mode: 'smart' });
	});
});

describe('formatting with the repo’s Prettier config', () => {
	it('the committed file and an in-place edit both pass prettier.check', async () => {
		expect(await isFormatted(committed)).toBe(true);
		const edited = editConfigText(
			committed,
			templateText,
			wanted({
				hosting: 'custom',
				hostname: 'epoch.example.com',
				emailSender: 'welcome@example.com'
			})
		);
		const formatted = await formatWithRepoConfig(
			edited,
			join(root, 'wrangler.deploy.jsonc'),
			(m) => {
				throw new Error(m);
			}
		);
		expect(
			await prettier.check(formatted, {
				filepath: join(root, 'wrangler.deploy.jsonc'),
				...((await prettier.resolveConfig(join(root, 'wrangler.deploy.jsonc'))) ?? {}),
				plugins: [],
				parser: 'jsonc'
			})
		).toBe(true);
		expect(formatted).toContain('// Or on a custom domain instead');
	});

	it('a file made from the template is formatted too, and unchanged values keep it that way', async () => {
		const file = join(root, 'wrangler.deploy.jsonc');
		const fresh = await formatWithRepoConfig(
			editConfigText(null, templateText, wanted()),
			file,
			() => {}
		);
		expect(
			await formatWithRepoConfig(editConfigText(fresh, templateText, wanted()), file, () => {})
		).toBe(fresh);
	});

	it('warns instead of failing when Prettier cannot be used', async () => {
		const warnings: string[] = [];
		const text = await formatWithRepoConfig('{ not json', join(root, 'x.jsonc'), (m) =>
			warnings.push(m)
		);
		expect(text).toBe('{ not json');
		expect(warnings[0]).toContain('written unformatted');
	});
});
