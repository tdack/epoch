import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SetupError } from './errors.ts';
import {
	STEP_NAMES,
	lastCompletedStep,
	newManifest,
	nextStep,
	parseManifest,
	readManifest,
	withStepDone,
	writeManifest
} from './manifest.ts';

const dirs: string[] = [];
function tempFile() {
	const dir = mkdtempSync(join(tmpdir(), 'epoch-manifest-'));
	dirs.push(dir);
	return join(dir, '.epoch', 'install.json');
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('manifest file', () => {
	it('is null when there is no install here', () => {
		expect(readManifest(tempFile())).toBeNull();
	});

	it('round-trips, stamps updatedAt and leaves no temp file behind', () => {
		const file = tempFile();
		const written = writeManifest(
			file,
			newManifest('epoch', new Date('2026-01-01T00:00:00Z')),
			new Date('2026-02-02T00:00:00Z')
		);
		expect(written.updatedAt).toBe('2026-02-02T00:00:00.000Z');
		expect(readManifest(file)).toEqual(written);
		expect(readdirSync(join(file, '..'))).toEqual(['install.json']);
	});

	it('refuses a file of an unknown shape rather than guessing', () => {
		expect(() => parseManifest('{"version":2}')).toThrow(SetupError);
		expect(() => parseManifest('not json')).toThrow('not valid JSON');
	});
});

describe('resume', () => {
	it('resumes at the first step that has not completed', () => {
		let manifest = newManifest('epoch');
		expect(nextStep(manifest)).toBe('preflight');
		for (const step of ['preflight', 'sign-in', 'collect', 'reconcile'] as const)
			manifest = withStepDone(manifest, step);
		expect(nextStep(manifest)).toBe('plan');
		expect(lastCompletedStep(manifest)).toBe('reconcile');
	});

	it('marking a step twice changes nothing', () => {
		const once = withStepDone(newManifest('epoch'), 'preflight');
		expect(withStepDone(once, 'preflight')).toBe(once);
	});

	it('a finished install has no next step', () => {
		let manifest = newManifest('epoch');
		for (const step of STEP_NAMES) manifest = withStepDone(manifest, step);
		expect(nextStep(manifest)).toBeNull();
	});

	it('survives an interrupted run: what was written after one step is read back for the next', () => {
		const file = tempFile();
		let manifest = newManifest('epoch');
		manifest = writeManifest(file, {
			...withStepDone(manifest, 'provision'),
			resources: { ...manifest.resources, d1: { id: 'abc', name: 'epoch-db' } }
		});
		const resumed = readManifest(file)!;
		expect(resumed.resources.d1).toEqual({ id: 'abc', name: 'epoch-db' });
		expect(resumed.installId).toBe(manifest.installId);
	});
});
