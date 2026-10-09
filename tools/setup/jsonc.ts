/**
 * Strips comments and trailing commas from JSONC. It walks the text with a string state because
 * a `//` inside a string is data (every URL has one), which a regex cannot tell apart.
 */
export function stripJsonc(text: string): string {
	let out = '';
	let i = 0;
	let isInString = false;
	while (i < text.length) {
		const ch = text[i]!;
		const next = text[i + 1];
		if (isInString) {
			out += ch;
			if (ch === '\\' && next !== undefined) {
				out += next;
				i += 2;
				continue;
			}
			if (ch === '"') isInString = false;
			i += 1;
			continue;
		}
		if (ch === '"') {
			isInString = true;
			out += ch;
			i += 1;
		} else if (ch === '/' && next === '/') {
			while (i < text.length && text[i] !== '\n') i += 1;
		} else if (ch === '/' && next === '*') {
			i += 2;
			while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
			i += 2;
		} else {
			out += ch;
			i += 1;
		}
	}
	return removeTrailingCommas(out);
}

function removeTrailingCommas(text: string): string {
	let out = '';
	let isInString = false;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i]!;
		if (isInString) {
			out += ch;
			if (ch === '\\') {
				out += text[i + 1] ?? '';
				i += 1;
			} else if (ch === '"') isInString = false;
			continue;
		}
		if (ch === '"') isInString = true;
		if (ch === ',') {
			let j = i + 1;
			while (j < text.length && /\s/.test(text[j]!)) j += 1;
			if (text[j] === '}' || text[j] === ']') continue;
		}
		out += ch;
	}
	return out;
}

export function parseJsonc(text: string): unknown {
	return JSON.parse(stripJsonc(text));
}
