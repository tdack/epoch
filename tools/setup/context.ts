import type { CloudflareApi } from './cloudflare.ts';
import type { InstallPaths } from './paths.ts';
import type { Manifest } from './manifest.ts';
import type { Runner } from './run.ts';
import type { WranglerApi, WranglerAuth } from './wrangler.ts';

/** Progress a step reports. Rendered by ui.ts; tests collect it. */
export interface Reporter {
	info(message: string): void;
	warn(message: string): void;
}

/** Work that must still happen if the process is interrupted, such as deleting a minted token. */
export interface Cleanup {
	/** Returns a function that removes the entry once the work is done in the normal way. */
	add(label: string, run: () => Promise<void>): () => void;
}

export interface FileSystem {
	exists(path: string): boolean;
	read(path: string): string;
	write(path: string, text: string): void;
	/** File names directly inside a directory. */
	list(dir: string): string[];
}

export interface StepContext {
	paths: InstallPaths;
	runner: Runner;
	cf: CloudflareApi;
	/** Wrangler under the given credential. Created on demand because an ephemeral token does not exist yet at sign-in. */
	makeWrangler(auth: WranglerAuth): WranglerApi;
	cleanup: Cleanup;
	report: Reporter;
	fs: FileSystem;
	env: NodeJS.ProcessEnv;
	/** Persist the manifest now. Steps call it as soon as a resource id exists. */
	save(manifest: Manifest): Manifest;
	now(): Date;
	fetch: typeof fetch;
	sleep(milliseconds: number): Promise<void>;
	/** The version of Node running the tool, e.g. `24.11.1`. */
	nodeVersion: string;
}

export function createCleanup(): Cleanup & { runAll(): Promise<void> } {
	const entries = new Map<symbol, { label: string; run: () => Promise<void> }>();
	return {
		add(label, run) {
			const key = Symbol(label);
			entries.set(key, { label, run });
			return () => {
				entries.delete(key);
			};
		},
		async runAll() {
			for (const [key, entry] of [...entries]) {
				entries.delete(key);
				try {
					await entry.run();
				} catch {
					// Cleanup is best effort; the next run's sweep catches what this missed.
				}
			}
		}
	};
}
