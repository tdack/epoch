import { applyEdits, modify, type JSONPath } from 'jsonc-parser';
import { HEADER } from './deploy-config.ts';
import { parseJsonc } from './jsonc.ts';

type Json = Record<string, unknown>;

/**
 * Top-level keys the generator owns. When the wanted config lacks one the existing file has (a
 * route after moving to workers.dev, `send_email` once removed), it is deleted; any other key in an
 * existing file is the owner's and stays.
 */
const MANAGED_KEYS = ['routes', 'preview_urls', 'send_email'];

function isJson(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Change {
	path: JSONPath;
	value: unknown;
}

/** The smallest set of edits that turns `base` into `wanted`: objects and equal-length arrays recurse. */
function planChanges(base: unknown, wanted: unknown, path: JSONPath, out: Change[]): void {
	if (isJson(base) && isJson(wanted)) {
		for (const [key, value] of Object.entries(wanted)) {
			if (key in base) planChanges(base[key], value, [...path, key], out);
			else out.push({ path: [...path, key], value });
		}
		if (path.length === 0) {
			for (const key of MANAGED_KEYS) {
				if (key in base && !(key in wanted)) out.push({ path: [key], value: undefined });
			}
		}
		return;
	}
	if (Array.isArray(base) && Array.isArray(wanted) && base.length === wanted.length) {
		wanted.forEach((value, index) => planChanges(base[index], value, [...path, index], out));
		return;
	}
	if (JSON.stringify(base) !== JSON.stringify(wanted)) out.push({ path, value: wanted });
}

/**
 * Edits `existing` (or, with none, the template under the generator's header) so it holds `wanted`,
 * changing only the lines whose values differ. Comments, key order and layout survive, and an
 * unchanged config comes back byte-for-byte.
 */
export function editConfigText(
	existing: string | null,
	templateText: string,
	wanted: Json
): string {
	let text = existing !== null && existing.trim() !== '' ? existing : `${HEADER}${templateText}`;
	let base: unknown;
	try {
		base = parseJsonc(text);
	} catch {
		text = `${HEADER}${templateText}`;
		base = parseJsonc(text);
	}
	const changes: Change[] = [];
	planChanges(base, wanted, [], changes);
	for (const change of changes) {
		text = applyEdits(
			text,
			modify(text, change.path, change.value, {
				formattingOptions: { insertSpaces: false, tabSize: 1, eol: '\n' }
			})
		);
	}
	return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Formats with the repository's own Prettier configuration (tabs, 100 columns), so new keys match
 * and `npm run lint` stays green. Prettier is the root's dependency; if it cannot be loaded the text
 * is returned as it is, and that is a warning, never a failed run.
 */
export async function formatWithRepoConfig(
	text: string,
	file: string,
	warn: (message: string) => void
): Promise<string> {
	try {
		const prettier = await import('prettier');
		const options = (await prettier.resolveConfig(file)) ?? {};
		// JSON needs no plugin, and the repo's Svelte and Tailwind plugins may not load from here.
		return await prettier.format(text, { ...options, plugins: [], parser: 'jsonc' });
	} catch (error) {
		warn(
			`Could not format ${file} with Prettier (${(error as Error).message}); it was written unformatted.`
		);
		return text;
	}
}
