import type { RequestHandler } from '@sveltejs/kit';
import { errorResponse } from '#lib/server/http/error-response.js';
import { enforceRateLimit } from '#lib/server/http/rate-limit.js';
import { Logger } from '#lib/server/logging/logger.js';
import {
	MAX_CSP_REPORT_BYTES,
	readBoundedText,
	summariseCspReports
} from '#lib/server/http/csp-report.js';

/**
 * Receives the browser's report-only violations (ADR-048). It takes anonymous POSTs, since the browser
 * sends a report without a credential, so it answers 204 whatever the body, reads at most
 * `MAX_CSP_REPORT_BYTES` of it, and logs one line carrying only the summary from `summariseCspReports`,
 * never the raw report.
 */
export const POST: RequestHandler = async ({ request, locals, url, platform }) => {
	try {
		// By address, since a report carries no credential. A 429 is as harmless to the browser as a 204.
		await enforceRateLimit({
			binding: platform?.env?.CSP_REPORT_RATE_LIMIT,
			bindingName: 'CSP_REPORT_RATE_LIMIT',
			key: request.headers.get('cf-connecting-ip') ?? 'unknown',
			message: 'Too many reports; try again in a minute'
		});
	} catch (err) {
		return errorResponse(err, 'Failed to accept the report');
	}
	const raw = await readBoundedText(request, MAX_CSP_REPORT_BYTES);
	if (raw === null) return new Response(null, { status: 413 });

	const violations = summariseCspReports(raw);
	if (violations.length > 0) {
		// One line per POST, however many violations it carries: the log is billed by line.
		new Logger({
			correlationId: locals.correlationId,
			path: url.pathname,
			method: 'POST'
		}).warn('Content-Security-Policy violation (report-only)', { violations });
	}
	return new Response(null, { status: 204 });
};
