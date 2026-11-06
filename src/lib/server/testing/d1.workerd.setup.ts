/// <reference types="@cloudflare/vitest-plugin/types" />
import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import type { D1Database } from '@cloudflare/workers-types';

// The bindings come from the `d1` project's miniflare options, which the generated Env does not see.
const { DB, TEST_MIGRATIONS } = env as unknown as {
	DB: D1Database;
	TEST_MIGRATIONS: D1Migration[];
};

// Storage is isolated per test file, so each file starts from an empty D1.
await applyD1Migrations(DB, TEST_MIGRATIONS);

// workerd reports a rejection as unhandled before a handler attached a microtask later (an awaited
// `return run()`, or `expect(...).rejects`), then reports it handled. Node waits for the microtask
// queue to drain first, so hold each report for a macrotask and pass on only those still unhandled.
const reporters = process.listeners('unhandledRejection');
process.removeAllListeners('unhandledRejection');
const pending = new Set<Promise<unknown>>();
process.on('rejectionHandled', (promise: Promise<unknown>) => pending.delete(promise));
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
	pending.add(promise);
	setTimeout(() => {
		if (!pending.delete(promise)) return;
		for (const report of reporters) report(reason, promise);
	});
});
