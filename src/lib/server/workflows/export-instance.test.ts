import { describe, expect, it } from 'vitest';
import { ValidationError } from '../domain/errors';
import {
	buildExportInstanceId,
	EXPORT_CODES,
	EXPORT_LIFECYCLE_PREFIX,
	EXPORT_STATES,
	EXPORT_TTL_SECONDS,
	exportObjectKey,
	exportWriteTime,
	isExportExpired,
	mapWorkflowStatus,
	matchesExportKey,
	parseExportInstanceId,
	type WorkflowInstanceStatus
} from './export-instance';

const TREE = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';

describe('buildExportInstanceId', () => {
	it('carries the tree, a format token and the client id, and round-trips', () => {
		const id = buildExportInstanceId(TREE, 'gedcom551', false, CLIENT);
		expect(id).toBe(`export_${TREE}_g551_${CLIENT}`);
		expect(parseExportInstanceId(id)).toEqual({
			treeId: TREE,
			token: 'g551',
			format: 'gedcom551',
			shouldCompress: false,
			clientUuid: CLIENT
		});
	});

	it('distinguishes a 7.0 file from a 7.0 GEDZip', () => {
		const plain = buildExportInstanceId(TREE, 'gedcom7', false, CLIENT);
		const zipped = buildExportInstanceId(TREE, 'gedcom7', true, CLIENT);
		expect(plain).toBe(`export_${TREE}_g7_${CLIENT}`);
		expect(zipped).toBe(`export_${TREE}_g7z_${CLIENT}`);
		expect(parseExportInstanceId(zipped)).toMatchObject({
			format: 'gedcom7',
			shouldCompress: true
		});
	});

	it('stays within 100 characters and the safe charset', () => {
		const id = buildExportInstanceId(TREE, 'gedcom7', true, CLIENT);
		expect(id.length).toBeLessThanOrEqual(100);
		expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('refuses a 5.5.1 file packaged as GEDZip, which has no such form', () => {
		expect(() => buildExportInstanceId(TREE, 'gedcom551', true, CLIENT)).toThrow(ValidationError);
	});

	it('refuses ids that are not UUIDs rather than truncating them', () => {
		expect(() => buildExportInstanceId('not-a-uuid', 'gedcom7', false, CLIENT)).toThrow(
			/unsafe input/
		);
		expect(() => buildExportInstanceId(TREE, 'gedcom7', false, 'not-a-uuid')).toThrow(
			/unsafe input/
		);
	});
});

describe('parseExportInstanceId', () => {
	it('is anchored: trailing or leading text is not an instance id', () => {
		const id = buildExportInstanceId(TREE, 'gedcom7', false, CLIENT);
		expect(parseExportInstanceId(`${id} `)).toBeNull();
		expect(parseExportInstanceId(` ${id}`)).toBeNull();
		expect(parseExportInstanceId(`x${id}`)).toBeNull();
		expect(parseExportInstanceId(`${id}x`)).toBeNull();
	});

	it('rejects a client id forged with extra separators', () => {
		// A split-based reader would see this as the same export; the anchored pattern does not.
		expect(parseExportInstanceId(`export_${TREE}_g7_${CLIENT}_extra`)).toBeNull();
		expect(parseExportInstanceId(`export_${TREE}_g7_${CLIENT.replace(/-/g, '_')}`)).toBeNull();
	});

	it('rejects anything that is not a minted id', () => {
		expect(parseExportInstanceId('')).toBeNull();
		expect(parseExportInstanceId('workflow_instance')).toBeNull();
		expect(parseExportInstanceId(`export_${TREE}_gX_${CLIENT}`)).toBeNull();
		expect(
			parseExportInstanceId(`export_${TREE.toUpperCase().replace('1', 'A')}_g7_${CLIENT}`)
		).toBeNull();
	});
});

describe('exportObjectKey / matchesExportKey', () => {
	it('derives the key from the same parts, choosing the extension by token', () => {
		expect(exportObjectKey(TREE, 'g551', CLIENT)).toBe(
			`${EXPORT_LIFECYCLE_PREFIX}${TREE}-${CLIENT}.ged`
		);
		expect(exportObjectKey(TREE, 'g7', CLIENT)).toBe(
			`${EXPORT_LIFECYCLE_PREFIX}${TREE}-${CLIENT}.ged`
		);
		expect(exportObjectKey(TREE, 'g7z', CLIENT)).toBe(
			`${EXPORT_LIFECYCLE_PREFIX}${TREE}-${CLIENT}.gdz`
		);
		expect(exportObjectKey(TREE, 'g7z', CLIENT).startsWith(EXPORT_LIFECYCLE_PREFIX)).toBe(true);
	});

	it('matches only the exact key the instance names', () => {
		const parsed = parseExportInstanceId(buildExportInstanceId(TREE, 'gedcom7', false, CLIENT))!;
		expect(matchesExportKey(exportObjectKey(TREE, 'g7', CLIENT), parsed)).toBe(true);
		// A different client, another tree, or the compressed form is not this export.
		expect(matchesExportKey(`exports/${TREE}-${CLIENT}.gdz`, parsed)).toBe(false);
		expect(matchesExportKey(`exports/${TREE}-${CLIENT}0.ged`, parsed)).toBe(false);
		expect(matchesExportKey(`exports/${TREE}x-${CLIENT}.ged`, parsed)).toBe(false);
		expect(matchesExportKey(`media/${TREE}-${CLIENT}.ged`, parsed)).toBe(false);
	});
});

describe('mapWorkflowStatus', () => {
	it('answers every member of the workflow status union', () => {
		const expected: Record<WorkflowInstanceStatus, ReturnType<typeof mapWorkflowStatus>> = {
			queued: 'queued',
			running: 'running',
			paused: 'running',
			waiting: 'running',
			waitingForPause: 'running',
			rollingBack: 'running',
			complete: 'complete',
			errored: 'errored',
			terminated: 'errored',
			unknown: 'errored'
		};
		for (const [status, state] of Object.entries(expected) as [WorkflowInstanceStatus, string][]) {
			expect(mapWorkflowStatus(status), status).toBe(state);
		}
	});

	it('names a ttl that matches the lifecycle rule', () => {
		expect(EXPORT_TTL_SECONDS).toBe(86400);
	});

	it('gives every state exactly one code', () => {
		expect(Object.keys(EXPORT_CODES).sort()).toEqual(Object.keys(EXPORT_STATES).sort());
		expect(new Set(Object.values(EXPORT_CODES)).size).toBe(Object.keys(EXPORT_CODES).length);
	});
});

describe('expiry', () => {
	const now = new Date('2026-01-02T00:00:00Z');
	const r2Uploaded = new Date('2025-12-30T00:00:00Z');

	it('prefers the upload time this application recorded over R2’s own', () => {
		const recorded = new Date('2026-01-01T00:00:00Z');
		expect(
			exportWriteTime({
				uploaded: r2Uploaded,
				customMetadata: { uploadedAt: recorded.toISOString() }
			})
		).toEqual(recorded);
		// A copy resets R2's `uploaded`; our record is the authority, and an unreadable one falls back.
		expect(exportWriteTime({ uploaded: r2Uploaded })).toEqual(r2Uploaded);
		expect(
			exportWriteTime({ uploaded: r2Uploaded, customMetadata: { uploadedAt: 'not a date' } })
		).toEqual(r2Uploaded);
	});

	it('expires strictly after the window', () => {
		expect(isExportExpired(new Date('2026-01-01T00:00:00Z'), now)).toBe(false);
		expect(isExportExpired(new Date('2025-12-31T23:59:59Z'), now)).toBe(true);
		expect(isExportExpired(r2Uploaded, now)).toBe(true);
	});
});
