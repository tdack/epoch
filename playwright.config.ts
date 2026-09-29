import { defineConfig } from '@playwright/test';

const PORT = 5179;

/**
 * Browser tests run against a real dev server and its local D1. Each spec creates its own
 * uniquely named tree through the API and deletes it afterwards, so a developer's data is never
 * touched. They are deliberately outside `npm test` and the commit gate.
 *
 * They drive the installed Google Chrome (`channel: 'chrome'`) so no browser download is needed;
 * on a machine without Chrome run `npx playwright install chromium` and remove the channel.
 */
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL: `http://localhost:${PORT}`,
		channel: 'chrome',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: `npm run dev -- --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: true,
		timeout: 120_000
	}
});
