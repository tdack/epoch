/** Largest report body read. A browser's report is a few hundred bytes, so more is noise or abuse. */
export const MAX_CSP_REPORT_BYTES = 16 * 1024;

/** Reports kept from one POST. A page that violates the policy on every load can send many. */
const MAX_REPORTS_PER_POST = 10;

/**
 * The request body as text, or null once it passes `maxBytes`. It counts the bytes as they stream
 * and cancels the read, because `Content-Length` is absent on a chunked body and a client may
 * understate it; an unbounded `request.text()` would buffer whatever the platform lets through.
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > maxBytes) return null;
	if (!request.body) return '';

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	for (;;) {
		const { done: isDone, value } = await reader.read();
		if (isDone) break;
		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const body = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

/** The fields worth logging. The full report carries whole URLs, which can hold query strings. */
export interface CspViolationSummary {
	violatedDirective: string;
	blocked: string;
	documentPath: string;
}

/**
 * Reads both report formats a browser may send: the legacy `application/csp-report` object and the
 * Reporting API array (`application/reports+json`). Anything else yields nothing, so a malformed
 * POST cannot write to the log.
 */
export function summariseCspReports(raw: string): CspViolationSummary[] {
	if (raw.length > MAX_CSP_REPORT_BYTES) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	const entries = (Array.isArray(parsed) ? parsed : [parsed]).slice(0, MAX_REPORTS_PER_POST);
	return entries.flatMap((entry) => {
		const summary = summariseEntry(entry);
		return summary ? [summary] : [];
	});
}

function summariseEntry(entry: unknown): CspViolationSummary | null {
	if (!isRecord(entry)) return null;
	const legacy = isRecord(entry['csp-report']) ? entry['csp-report'] : null;
	const reporting = entry.type === 'csp-violation' && isRecord(entry.body) ? entry.body : null;
	const fields = legacy ?? reporting;
	if (!fields) return null;

	const directive = legacy ? fields['violated-directive'] : fields.effectiveDirective;
	const blocked = legacy ? fields['blocked-uri'] : fields.blockedURL;
	const document = legacy ? fields['document-uri'] : fields.documentURL;
	return {
		violatedDirective: text(directive),
		blocked: blockedSource(text(blocked)),
		documentPath: pathOf(text(document))
	};
}

/** A blocked URL is logged as its origin; a keyword such as `inline` or `eval` is kept as it is. */
function blockedSource(value: string): string {
	try {
		const url = new URL(value);
		return url.origin === 'null' ? url.protocol : url.origin;
	} catch {
		return value.slice(0, 200);
	}
}

function pathOf(value: string): string {
	try {
		return new URL(value).pathname;
	} catch {
		return '';
	}
}

function text(value: unknown): string {
	return typeof value === 'string' ? value.slice(0, 200) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
