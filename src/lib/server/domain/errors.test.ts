import { describe, expect, it } from 'vitest';
import { ExportExpiredError, ExportUnavailableError } from './errors';

describe('export lifecycle errors', () => {
	it('reports an expired export as 410 with a fixed, id-free message', () => {
		const error = new ExportExpiredError();
		expect(error).toMatchObject({
			status: 410,
			code: 'export_expired',
			name: 'ExportExpiredError'
		});
		// A caller must not be able to learn which instance ids exist from the wording.
		expect(error.message).toBe('This export has expired. Start a new one.');
	});

	it('reports an unreadable export as 503 with a fixed message', () => {
		const error = new ExportUnavailableError();
		expect(error).toMatchObject({
			status: 503,
			code: 'export_unavailable',
			name: 'ExportUnavailableError'
		});
		expect(error.message).toBe('The export service is temporarily unavailable');
	});
});
