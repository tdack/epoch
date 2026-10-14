import { describe, expect, it } from 'vitest';
import { MAX_CSP_REPORT_BYTES, readBoundedText, summariseCspReports } from './csp-report';

describe('summariseCspReports', () => {
	it('reads a legacy application/csp-report body, keeping the origin and not the query', () => {
		const raw = JSON.stringify({
			'csp-report': {
				'violated-directive': 'script-src-elem',
				'blocked-uri': 'https://cdn.example.net/lib.js?token=secret',
				'document-uri': 'https://epoch.example.com/trees/x?focus=abc#top'
			}
		});
		expect(summariseCspReports(raw)).toEqual([
			{
				violatedDirective: 'script-src-elem',
				blocked: 'https://cdn.example.net',
				documentPath: '/trees/x'
			}
		]);
	});

	it('reads the Reporting API array format', () => {
		const raw = JSON.stringify([
			{
				type: 'csp-violation',
				body: {
					effectiveDirective: 'style-src-attr',
					blockedURL: 'inline',
					documentURL: 'https://epoch.example.com/'
				}
			}
		]);
		expect(summariseCspReports(raw)).toEqual([
			{ violatedDirective: 'style-src-attr', blocked: 'inline', documentPath: '/' }
		]);
	});

	it('ignores other report types and malformed bodies', () => {
		expect(summariseCspReports('not json')).toEqual([]);
		expect(summariseCspReports(JSON.stringify({ type: 'deprecation', body: {} }))).toEqual([]);
		expect(summariseCspReports('null')).toEqual([]);
	});

	it('drops a body larger than the limit without parsing it', () => {
		const raw = JSON.stringify({
			'csp-report': { 'violated-directive': 'x'.repeat(MAX_CSP_REPORT_BYTES) }
		});
		expect(summariseCspReports(raw)).toEqual([]);
	});

	it('caps the number of reports taken from one POST', () => {
		const raw = JSON.stringify(
			Array.from({ length: 50 }, () => ({
				type: 'csp-violation',
				body: { effectiveDirective: 'img-src' }
			}))
		);
		expect(summariseCspReports(raw)).toHaveLength(10);
	});
});

describe('readBoundedText', () => {
	const post = (body: BodyInit | ReadableStream, headers: HeadersInit = {}) =>
		new Request('https://epoch.example.com/api/csp-report', {
			method: 'POST',
			body: body as BodyInit,
			headers,
			// A stream body needs half-duplex in Node's fetch implementation.
			...({ duplex: 'half' } as object)
		});

	it('reads a small body whole', async () => {
		expect(await readBoundedText(post('{"a":1}'), 100)).toBe('{"a":1}');
	});

	it('refuses a body whose declared length is over the cap, without reading it', async () => {
		const request = post('x', { 'content-length': '101' });
		expect(await readBoundedText(request, 100)).toBeNull();
	});

	it('cancels a stream that passes the cap although no length was declared', async () => {
		let pulls = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls++;
				controller.enqueue(new Uint8Array(40));
				if (pulls > 50) controller.close();
			}
		});
		expect(await readBoundedText(post(stream), 100)).toBeNull();
		// It stopped reading soon after the cap rather than draining all fifty chunks.
		expect(pulls).toBeLessThan(10);
	});
});
