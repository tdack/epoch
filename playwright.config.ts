import { defineConfig } from '@playwright/test';

/**
 * `E2E_PORT` lets parallel worktrees each run their own server: with one fixed port,
 * `reuseExistingServer` silently tested whichever worktree started first.
 */
const PORT = Number(process.env.E2E_PORT ?? 5179);

/**
 * Browser tests run against a real dev server and its local D1. Each spec creates its own
 * uniquely named tree through the API and deletes it afterwards, so a developer's data is never
 * touched. They are deliberately outside `npm test` and the commit gate.
 *
 * They drive the installed Google Chrome (`channel: 'chrome'`) so no browser download is needed;
 * on a machine without Chrome run `npx playwright install chromium` and remove the channel.
 * WebKit ran the CSS 3D views' specs until those views were removed (ADR-047).
 */

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
	webServer: {
		command: `npm run dev -- --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: true,
		timeout: 120_000
	}
});
